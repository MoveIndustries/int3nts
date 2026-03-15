import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoordinatorClient } from '../src/coordinator.js';

describe('CoordinatorClient', () => {
  const TEST_URL = 'http://localhost:8080';

  // ============================================================================
  // ENDPOINT TESTS
  // ============================================================================

  describe('constructor', () => {
    /// 1. Test: Constructor Requires Explicit URL
    /// Verifies that the client accepts a coordinator URL at construction time.
    /// Why: The SDK must not read environment variables — all config is caller-provided.
    it('accepts a coordinator URL', () => {
      const client = new CoordinatorClient(TEST_URL);
      expect(client).toBeDefined();
    });
  });

  describe('health', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    /// 2. Test: Health Check Endpoint
    /// Verifies that health() calls GET /health with correct URL and headers.
    /// Why: Ensures the client builds URLs from the provided base, not from hardcoded values.
    it('calls GET /health', async () => {
      const mockResponse = { success: true, data: 'ok', error: null };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.health();

      expect(fetch).toHaveBeenCalledWith(
        `${TEST_URL}/health`,
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createDraftIntent', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    /// 3. Test: Create Draft Intent
    /// Verifies that createDraftIntent() sends POST /draftintent with the full request body.
    /// Why: Draft creation is the entry point of the requester flow — incorrect serialization breaks negotiation.
    it('sends POST /draftintent with request body', async () => {
      const mockResponse = {
        success: true,
        data: { draft_id: 'draft-1', status: 'pending' },
        error: null,
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const request = {
        requester_addr: '0x1234',
        draft_data: {
          intent_id: '0x' + '00'.repeat(32),
          offered_metadata: '0x1',
          offered_amount: '1000000',
          offered_chain_id: '250',
          desired_metadata: '0x2',
          desired_amount: '500000',
          desired_chain_id: '84532',
          expiry_time: 1700000000,
          issuer: '0x1234',
          fee_in_offered_token: '1000',
        },
        expiry_time: 1700000000,
      };

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.createDraftIntent(request);

      expect(fetch).toHaveBeenCalledWith(
        `${TEST_URL}/draftintent`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(request),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.draft_id).toBe('draft-1');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    /// 4. Test: HTTP Error Returns Structured Response
    /// Verifies that HTTP 500 returns {success: false} with the server's error message.
    /// Why: Callers must get actionable error info — swallowed failures hide coordinator problems.
    it('returns error response on HTTP 500', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'server exploded' }),
      }));

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.health();

      expect(result.success).toBe(false);
      expect(result.error).toBe('server exploded');
      expect(result.data).toBeNull();
    });

    /// 5. Test: Connection Error on Fetch Failure
    /// Verifies that a TypeError from fetch produces an actionable "Failed to connect" message.
    /// Why: Network failures must tell the caller that the coordinator is unreachable, not throw raw errors.
    it('returns connection error on fetch failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
        new TypeError('fetch failed'),
      ));

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.health();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to connect');
      expect(result.data).toBeNull();
    });
  });

  // ============================================================================
  // EXCHANGE RATE TESTS
  // ============================================================================

  describe('getExchangeRate', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    /// 6. Test: Exchange Rate Query with Offered Token Only
    /// Verifies that getExchangeRate() builds query params with only offered_chain_id and offered_token.
    /// Why: Partial queries (offered-only) are used for fee estimation before the user selects a desired token.
    it('builds query params for offered token only', async () => {
      const mockResponse = { success: true, data: { exchange_rate: 1.0 }, error: null };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const client = new CoordinatorClient(TEST_URL);
      await client.getExchangeRate(250, '0x1');

      const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('offered_chain_id=250');
      expect(calledUrl).toContain('offered_token=0x1');
      expect(calledUrl).not.toContain('desired_chain_id');
    });

    /// 7. Test: Exchange Rate Query with Desired Token
    /// Verifies that getExchangeRate() includes desired_chain_id and desired_token when provided.
    /// Why: Full exchange rate queries require both sides for accurate rate calculation.
    it('includes desired params when provided', async () => {
      const mockResponse = { success: true, data: { exchange_rate: 1.0 }, error: null };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const client = new CoordinatorClient(TEST_URL);
      await client.getExchangeRate(250, '0x1', 84532, '0x2');

      const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('desired_chain_id=84532');
      expect(calledUrl).toContain('desired_token=0x2');
    });
  });

  // ============================================================================
  // POLLING TESTS
  // ============================================================================

  describe('pollUntilSigned', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    /// 8. Test: Poll Timeout
    /// Verifies that pollUntilSigned() returns a timeout error when the deadline is exceeded.
    /// Why: Prevents infinite polling if the solver never signs — callers must get control back.
    it('returns timeout error when deadline exceeded', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          data: null,
          error: 'Draft not yet signed',
        }),
      }));

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.pollUntilSigned('draft-1', {
        interval: 10,
        timeout: 50,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Polling timeout');
    });

    /// 9. Test: Non-Polling Error Returns Immediately
    /// Verifies that errors other than "not yet signed" stop polling and return immediately.
    /// Why: Only the pending state should trigger retries — other errors (e.g., "not found") are final.
    it('returns immediately on non-polling error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          data: null,
          error: 'Draft not found',
        }),
      }));

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.pollUntilSigned('draft-1', {
        interval: 10,
        timeout: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Draft not found');
      // Should have only called once (no polling)
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    /// 10. Test: Poll Returns Signed Response
    /// Verifies that pollUntilSigned() retries and returns the signature once the solver signs.
    /// Why: Happy path — the requester must receive the solver's signature after polling through pending states.
    it('returns signed response when solver signs', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: false,
              data: null,
              error: 'Draft not yet signed',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              signature: '0xabc',
              solver_hub_addr: '0x123',
              timestamp: 1700000000,
            },
            error: null,
          }),
        });
      }));

      const client = new CoordinatorClient(TEST_URL);
      const result = await client.pollUntilSigned('draft-1', {
        interval: 10,
        timeout: 5000,
      });

      expect(result.success).toBe(true);
      expect(result.data?.signature).toBe('0xabc');
    });
  });
});
