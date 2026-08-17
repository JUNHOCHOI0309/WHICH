# Architecture

이 디렉터리는 제품 기획을 구현 계약으로 전환하는 문서를 관리합니다.

- `adr/`: 되돌릴 수 있는 기술 결정과 그 근거
- [Data Architecture v1](./data-architecture-v1.md): 논리 ERD, PostgreSQL 계약, Event Schema, PII·보존, 복구 절차

기획 문서의 Decision ID와 ADR을 연결하고, 결정이 바뀌면 기존 ADR을 삭제하지 않고
`Superseded` 상태와 대체 ADR 링크를 남깁니다.
