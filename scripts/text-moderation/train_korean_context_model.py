#!/usr/bin/env python3
"""Train the compact Korean context moderation model used by the WHICH API.

The source archives stay outside the repository.  This script reads them in place,
trains a deterministic hashed character/word n-gram logistic model, evaluates it
against the official conversation validation split, and writes only quantized
weights plus aggregate provenance and metrics.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import math
import random
import re
import struct
import time
import unicodedata
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Iterator, Sequence

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import roc_auc_score


DIMENSION = 1 << 17
CHAR_NGRAM_MIN = 2
CHAR_NGRAM_MAX = 5
BATCH_SIZE = 4096
CONTEXT_TURNS = 3
CONTEXT_LIMIT = 600
TOKEN_PATTERN = re.compile(r"[0-9a-z가-힣]+|[^\w\s]", re.IGNORECASE)


@dataclass(frozen=True)
class Example:
    target: str
    context: str
    label: int
    weight: float = 1.0


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).lower()).strip()


def fnv1a(value: str) -> int:
    result = 2166136261
    for byte in value.encode("utf-8"):
        result ^= byte
        result = (result * 16777619) & 0xFFFFFFFF
    return result


def feature_values(target: str, context: str) -> dict[int, float]:
    target = normalize_text(target)
    context = normalize_text(context)[-CONTEXT_LIMIT:]
    values: dict[int, float] = {}

    def add(feature: str, value: float) -> None:
        index = fnv1a(feature) & (DIMENSION - 1)
        values[index] = values.get(index, 0.0) + value

    def add_text(prefix: str, text: str, weight: float) -> set[str]:
        padded = f"^{text}$"
        for size in range(CHAR_NGRAM_MIN, CHAR_NGRAM_MAX + 1):
            for offset in range(max(0, len(padded) - size + 1)):
                add(f"{prefix}:c:{padded[offset:offset + size]}", weight)
        tokens = TOKEN_PATTERN.findall(text)
        token_set = set(tokens)
        for token in token_set:
            add(f"{prefix}:w:{token}", weight)
        for left, right in zip(tokens, tokens[1:]):
            add(f"{prefix}:w2:{left}\u241f{right}", weight)
        return token_set

    target_tokens = add_text("t", target, 1.0)
    if context:
        context_tokens = add_text("c", context, 0.35)
        for token in target_tokens.intersection(context_tokens):
            add(f"x:shared:{token}", 0.5)
        add(f"x:bridge:{context[-16:]}\u241e{target[:16]}", 0.5)

    norm = math.sqrt(sum(value * value for value in values.values())) or 1.0
    return {index: value / norm for index, value in values.items()}


def matrix(examples: Sequence[Example]) -> tuple[csr_matrix, np.ndarray, np.ndarray]:
    indices: list[int] = []
    data: list[float] = []
    indptr = [0]
    labels: list[int] = []
    weights: list[float] = []
    for example in examples:
        features = feature_values(example.target, example.context)
        for index, value in sorted(features.items()):
            indices.append(index)
            data.append(value)
        indptr.append(len(indices))
        labels.append(example.label)
        weights.append(example.weight)
    return (
        csr_matrix(
            (
                np.asarray(data, dtype=np.float32),
                np.asarray(indices, dtype=np.int32),
                np.asarray(indptr, dtype=np.int32),
            ),
            shape=(len(examples), DIMENSION),
        ),
        np.asarray(labels, dtype=np.int8),
        np.asarray(weights, dtype=np.float32),
    )


def batched(examples: Iterable[Example], size: int = BATCH_SIZE) -> Iterator[list[Example]]:
    batch: list[Example] = []
    for example in examples:
        if not example.target.strip():
            continue
        batch.append(example)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def shuffled_csv_examples(archive_path: Path, seed: int) -> list[Example]:
    examples: list[Example] = []
    with zipfile.ZipFile(archive_path) as archive:
        csv_entries = sorted(name for name in archive.namelist() if name.endswith(".csv"))
        for entry_name in csv_entries:
            rows = csv.reader(io.StringIO(archive.read(entry_name).decode("utf-8-sig")))
            header = next(rows)
            binary_stage = len(header) == 2
            for row in rows:
                if not row:
                    continue
                if binary_stage:
                    examples.append(Example(row[0], "", int(row[1]), 0.8))
                    continue
                category_values = [int(value or 0) for value in row[1:-1]]
                normal_value = int(row[-1] or 0)
                harmful = int(any(value > 0 for value in category_values) and normal_value == 0)
                severity = max(category_values, default=0)
                examples.append(Example(row[0], "", harmful, 0.8 + min(severity, 3) * 0.08))
    random.Random(seed).shuffle(examples)
    return examples


def conversation_examples(archive_path: Path, validation: bool) -> Iterator[Example]:
    wanted_suffix = "VL1_aihub.zip" if validation else "TL1_aihub.zip"
    with zipfile.ZipFile(archive_path) as outer:
        nested_name = next(name for name in outer.namelist() if name.endswith(wanted_suffix))
        with zipfile.ZipFile(io.BytesIO(outer.read(nested_name))) as inner:
            for json_name in sorted(name for name in inner.namelist() if name.endswith(".json")):
                conversations = json.loads(inner.read(json_name))
                random.Random(f"which:{json_name}").shuffle(conversations)
                for conversation in conversations:
                    prior: list[str] = []
                    for sentence in conversation.get("sentences", []):
                        target = str(sentence.get("text") or sentence.get("origin_text") or "")
                        yield Example(
                            target=target,
                            context=" \u241e ".join(prior[-CONTEXT_TURNS:]),
                            label=int(bool(sentence.get("is_immoral"))),
                            weight=1.25,
                        )
                        prior.append(target)


def train_batches(
    classifier: SGDClassifier,
    batches: Iterable[list[Example]],
    label: str,
    first_batch: bool,
) -> tuple[bool, int]:
    seen = 0
    started = time.monotonic()
    for number, batch in enumerate(batches, start=1):
        features, labels, weights = matrix(batch)
        if first_batch:
            classifier.partial_fit(features, labels, classes=np.asarray([0, 1]), sample_weight=weights)
            first_batch = False
        else:
            classifier.partial_fit(features, labels, sample_weight=weights)
        seen += len(batch)
        if number % 20 == 0:
            elapsed = time.monotonic() - started
            print(f"[{label}] samples={seen:,} elapsed={elapsed:.1f}s", flush=True)
    return first_batch, seen


def validation_scores(
    classifier: SGDClassifier, examples: Iterable[Example]
) -> tuple[np.ndarray, np.ndarray]:
    scores: list[np.ndarray] = []
    labels: list[np.ndarray] = []
    for batch in batched(examples):
        features, batch_labels, _ = matrix(batch)
        scores.append(classifier.predict_proba(features)[:, 1])
        labels.append(batch_labels)
    return np.concatenate(scores), np.concatenate(labels)


def threshold_for(
    scores: np.ndarray,
    labels: np.ndarray,
    minimum_precision: float,
    maximum_false_positive_rate: float,
    fallback: float,
) -> float:
    order = np.argsort(-scores)
    sorted_scores = scores[order]
    sorted_labels = labels[order]
    positives = np.cumsum(sorted_labels)
    false_positives = np.cumsum(1 - sorted_labels)
    safe_count = max(1, int(np.sum(labels == 0)))
    selected = None
    for index, score in enumerate(sorted_scores):
        predicted = index + 1
        precision = positives[index] / predicted
        false_positive_rate = false_positives[index] / safe_count
        if precision >= minimum_precision and false_positive_rate <= maximum_false_positive_rate:
            selected = float(score)
    return round(max(0.05, min(0.99, selected if selected is not None else fallback)), 6)


def metrics_at(scores: np.ndarray, labels: np.ndarray, threshold: float) -> dict[str, float | int]:
    predicted = scores >= threshold
    true_positive = int(np.sum(predicted & (labels == 1)))
    false_positive = int(np.sum(predicted & (labels == 0)))
    false_negative = int(np.sum(~predicted & (labels == 1)))
    true_negative = int(np.sum(~predicted & (labels == 0)))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    false_positive_rate = false_positive / max(1, false_positive + true_negative)
    return {
        "threshold": round(threshold, 6),
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "falsePositiveRate": round(false_positive_rate, 6),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "trueNegative": true_negative,
        "falseNegative": false_negative,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_artifact(
    output_path: Path,
    classifier: SGDClassifier,
    scores: np.ndarray,
    labels: np.ndarray,
    csv_archive: Path,
    context_archive: Path,
    training_samples: int,
) -> None:
    # A review result immediately hides user content, so favor trustworthy
    # review decisions over recall: at least 95% precision and at most 1% FPR.
    review_threshold = threshold_for(scores, labels, 0.95, 0.01, 0.9)
    block_threshold = threshold_for(scores, labels, 0.97, 0.005, 0.9)
    block_threshold = max(block_threshold, review_threshold + 0.02)
    coefficient = classifier.coef_[0].astype(np.float64)
    maximum = float(np.max(np.abs(coefficient))) or 1.0
    scale = maximum / 32767.0
    quantized = np.rint(coefficient / scale).clip(-32767, 32767).astype("<i2")
    encoded = base64.b64encode(quantized.tobytes()).decode("ascii")
    artifact = {
        "schemaVersion": 1,
        "modelVersion": f"korean-context-hash-logreg-{date.today().isoformat()}",
        "policyVersion": "korean-context-text-v1",
        "algorithm": "hashed-char-word-ngram-logistic-regression",
        "dimension": DIMENSION,
        "characterNgrams": [CHAR_NGRAM_MIN, CHAR_NGRAM_MAX],
        "contextTurns": CONTEXT_TURNS,
        "contextCharacterLimit": CONTEXT_LIMIT,
        "contextFeatureWeight": 0.35,
        "bridgeFeatureWeight": 0.5,
        "weightScale": scale,
        "weightsBase64Int16Le": encoded,
        "intercept": float(classifier.intercept_[0]),
        "thresholds": {"review": review_threshold, "block": block_threshold},
        "training": {
            "samples": training_samples,
            "validationSamples": int(labels.size),
            "validationPositiveRate": round(float(np.mean(labels)), 6),
            "rocAuc": round(float(roc_auc_score(labels, scores)), 6),
            "review": metrics_at(scores, labels, review_threshold),
            "block": metrics_at(scores, labels, block_threshold),
            "sources": [
                {
                    "file": context_archive.name,
                    "sha256": sha256(context_archive),
                    "usage": "conversation-context training and official validation split",
                },
                {
                    "file": csv_archive.name,
                    "sha256": sha256(csv_archive),
                    "usage": "harmful-expression binary and category training",
                },
            ],
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps({key: value for key, value in artifact.items() if key != "weightsBase64Int16Le"}, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--context-archive", type=Path, required=True)
    parser.add_argument("--harmful-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    classifier = SGDClassifier(
        loss="log_loss",
        penalty="l2",
        alpha=2e-6,
        learning_rate="optimal",
        average=True,
        random_state=20260909,
    )
    first_batch = True
    total = 0

    csv_examples = shuffled_csv_examples(args.harmful_archive, 20260909)
    first_batch, seen = train_batches(classifier, batched(csv_examples), "harmful-csv", first_batch)
    total += seen
    del csv_examples

    first_batch, seen = train_batches(
        classifier,
        batched(conversation_examples(args.context_archive, validation=False)),
        "conversation",
        first_batch,
    )
    total += seen
    if first_batch:
        raise RuntimeError("No training samples were loaded")

    scores, labels = validation_scores(
        classifier, conversation_examples(args.context_archive, validation=True)
    )
    write_artifact(
        args.output,
        classifier,
        scores,
        labels,
        args.harmful_archive,
        args.context_archive,
        total,
    )


if __name__ == "__main__":
    main()
