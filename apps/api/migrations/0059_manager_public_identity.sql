WITH manager_member AS (
  SELECT DISTINCT m.member_id
  FROM members AS m
  INNER JOIN member_credentials AS credential
    ON credential.member_id = m.member_id
  INNER JOIN operator_access_grants AS operator_grant
    ON operator_grant.member_id = m.member_id
    AND operator_grant.revoked_at IS NULL
  WHERE lower(credential.email_normalized) = 'skyho0309@naver.com'
)
UPDATE members AS member
SET display_name = 'WHICH_MANAGER',
    updated_at = now()
FROM manager_member
WHERE member.member_id = manager_member.member_id;

WITH manager_subject AS (
  SELECT subject.subject_id
  FROM voter_subjects AS subject
  INNER JOIN member_credentials AS credential
    ON credential.member_id = subject.user_id
  INNER JOIN operator_access_grants AS operator_grant
    ON operator_grant.member_id = credential.member_id
    AND operator_grant.revoked_at IS NULL
  WHERE subject.subject_kind = 'MEMBER'
    AND lower(credential.email_normalized) = 'skyho0309@naver.com'
)
UPDATE comments AS comment
SET author_display_name_snapshot = 'WHICH_MANAGER',
    updated_at = now()
FROM manager_subject
WHERE comment.author_subject_id = manager_subject.subject_id;
