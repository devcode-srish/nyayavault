# Phase 5: Intelligent Document Processing

## Feature Implemented
Automated Case Document Summarization and Named Entity Recognition (NER) for FIRs, evidence reports, and witness statements.

## Flow & Architecture
1. Request: Client sends POST `/api/documents/:id/ai-analyze` with auth token.
2. Authorization: Backend verifies JWT role and user's case membership. If unauthorized, returns HTTP 403 immediately.
3. Extraction: Backend reads the target document file and parses raw text.
4. Model Used: Google Gemini API (gemini-1.5-flash).
5. Output Schema:
   - summary: string[]
   - entities: { persons: [], locations: [], dates: [], evidenceTags: [], legalSections: [] }
   - piiDetected: boolean
6. Failure Handling:
   - Non-parseable/empty documents -> 400 Bad Request
   - Rate limit/network timeout -> 502 Bad Gateway with fallback message
   - Unauthorized access -> 403 Forbidden
7. Audit Log:
   - Action recorded as `DOCUMENT_AI_ANALYSIS` with timestamp and user ID.
