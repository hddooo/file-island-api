# Personal era override report

- Allows a manual workbook note to assign a valid era without changing the shared question catalog.
- Only current-version notes, existing owner scope and workbook source filter apply. Invalid values fall back to the shared era.
- Build and 11 unit tests passed; isolated PostgreSQL tests verify valid/missing/invalid overrides, owner isolation and unchanged shared classification.
- Deployment image: sha256:f34aafa28bbfcf5ec1bc85cc327efceb1dd1d050afd82eafb4612aded658aae5. One runtime JS changed; all Compose properties except image preserved.
- Production healthy; personal list readback and unauthenticated 401 checks passed. No deployment DB writes.
- First attempt reverted the image because automatic lobby/presence heartbeat changes failed an overly broad snapshot comparison. No rows were restored or deleted. Retry separately recorded those two runtime heartbeat tables; protected tables and migration ledger unchanged.
- Imported question data is handled separately by the private import task. Browser visual testing was not performed for this service-only change.
