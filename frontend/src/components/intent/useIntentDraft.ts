import { useState, useEffect, useRef } from 'react';
import {
  CoordinatorClient,
  type DraftData,
  type DraftIntentSignature,
  type FlowType,
  pollForSignature,
  pollForFulfillment,
} from '@int3nts/sdk';
import { CHAIN_CONFIGS } from '@/config/chains';

const FRONTEND_TIMER_SECS = 120;
const TIMER_UPDATE_INTERVAL_MS = 1000;

export function useIntentDraft({
  coordinator,
  flowType,
  transactionHash,
  mvmAddress,
}: {
  coordinator: CoordinatorClient;
  flowType: FlowType | null;
  transactionHash: string | null;
  mvmAddress: string;
}) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftCreatedAt, setDraftCreatedAt] = useState<number | null>(null);
  const [savedDraftData, setSavedDraftData] = useState<DraftData | null>(null);
  const [signature, setSignature] = useState<DraftIntentSignature | null>(null);
  const [pollingSignature, setPollingSignature] = useState(false);
  const [intentStatus, setIntentStatus] = useState<'pending' | 'created' | 'fulfilled'>('pending');
  const intentStatusRef = useRef<'pending' | 'created' | 'fulfilled'>('pending');
  const [pollingFulfillment, setPollingFulfillment] = useState(false);
  const pollingFulfillmentRef = useRef(false);
  const currentIntentIdRef = useRef<string | null>(null);
  const pollingActiveRef = useRef(false);
  const [fixedExpiryTime, setFixedExpiryTime] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep intentStatusRef in sync with state
  useEffect(() => {
    intentStatusRef.current = intentStatus;
  }, [intentStatus]);

  // Restore draft from localStorage after mount (avoids hydration mismatch)
  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const savedDraftId = localStorage.getItem('last_draft_id');
      const savedCreatedAt = localStorage.getItem('last_draft_created_at');
      if (savedDraftId && savedCreatedAt) {
        setDraftId(savedDraftId);
        setDraftCreatedAt(parseInt(savedCreatedAt, 10));
      } else {
        setDraftId(null);
        setDraftCreatedAt(null);
        setSignature(null);
        setSavedDraftData(null);
        setError(null);
      }
    }
  }, []);

  // Clear stale draft — savedDraftData is not persisted, so if draftId exists without it after
  // mount we cannot use the draft
  useEffect(() => {
    if (draftId && !savedDraftData && mounted) {
      console.log('Clearing stale draft - savedDraftData missing after page refresh');
      setDraftId(null);
      setDraftCreatedAt(null);
      setSignature(null);
      setError(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('last_draft_id');
        localStorage.removeItem('last_draft_created_at');
      }
    }
  }, [draftId, savedDraftData, mounted]);

  // Set fixed expiry time based on when draft was created
  useEffect(() => {
    if (draftCreatedAt) {
      setFixedExpiryTime(Math.floor(draftCreatedAt / 1000) + FRONTEND_TIMER_SECS);
    } else {
      setFixedExpiryTime(null);
    }
  }, [draftCreatedAt]);

  // Countdown timer — clears expired draft
  useEffect(() => {
    if (!fixedExpiryTime) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, fixedExpiryTime - now);
      setTimeRemaining(remaining * 1000);

      if (remaining === 0 && intentStatusRef.current !== 'fulfilled') {
        setDraftId(null);
        setDraftCreatedAt(null);
        setSavedDraftData(null);
        setFixedExpiryTime(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('last_draft_id');
          localStorage.removeItem('last_draft_created_at');
        }
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, TIMER_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fixedExpiryTime]);

  // Poll for solver signature when draft exists
  useEffect(() => {
    if (!draftId || pollingActiveRef.current || signature) return;

    pollingActiveRef.current = true;
    setPollingSignature(true);

    pollForSignature(coordinator, draftId, {
      expiryTime: fixedExpiryTime ?? undefined,
    }).then((sig) => {
      setSignature(sig);
    }).catch((err: Error) => {
      if (err.message === 'Draft not found') {
        localStorage.removeItem('last_draft_id');
        localStorage.removeItem('last_draft_created_at');
        setDraftId(null);
        setDraftCreatedAt(null);
        setSavedDraftData(null);
      }
    }).finally(() => {
      setPollingSignature(false);
      pollingActiveRef.current = false;
    });

    return () => {
      pollingActiveRef.current = false;
    };
  }, [draftId]); // Only depend on draftId - don't restart when fixedExpiryTime changes

  // Keep currentIntentIdRef in sync for use in polling closure
  useEffect(() => {
    currentIntentIdRef.current = savedDraftData?.intentId || null;
  }, [savedDraftData?.intentId]);

  // Poll for fulfillment
  useEffect(() => {
    if (!transactionHash || !savedDraftData || !signature || !flowType || pollingFulfillmentRef.current) return;

    const intentId = currentIntentIdRef.current;
    if (!intentId) return;

    pollingFulfillmentRef.current = true;
    setPollingFulfillment(true);
    setIntentStatus('created');

    pollForFulfillment({
      configs: CHAIN_CONFIGS,
      draftData: savedDraftData,
      flowType,
      intentId,
      solverHubAddr: signature.solver_hub_addr,
    }).then(() => {
      setIntentStatus('fulfilled');
    }).catch((err: Error) => {
      console.error('Fulfillment polling failed:', err.message);
    }).finally(() => {
      setPollingFulfillment(false);
      pollingFulfillmentRef.current = false;
    });

    // Don't reset pollingFulfillmentRef in cleanup - it causes re-runs when dependencies change
  }, [transactionHash, savedDraftData, flowType, mvmAddress]);

  const clearDraft = (extraCleanup?: () => void) => {
    setDraftId(null);
    setDraftCreatedAt(null);
    setSignature(null);
    setSavedDraftData(null);
    setFixedExpiryTime(null);
    setIntentStatus('pending');
    setPollingFulfillment(false);
    pollingFulfillmentRef.current = false;
    setError(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('last_draft_id');
      localStorage.removeItem('last_draft_created_at');
    }
    extraCleanup?.();
  };

  return {
    draftId,
    setDraftId,
    draftCreatedAt,
    setDraftCreatedAt,
    savedDraftData,
    setSavedDraftData,
    signature,
    setSignature,
    pollingSignature,
    setPollingSignature,
    pollingActiveRef,
    intentStatus,
    setIntentStatus,
    intentStatusRef,
    pollingFulfillment,
    pollingFulfillmentRef,
    fixedExpiryTime,
    timeRemaining,
    mounted,
    error,
    setError,
    clearDraft,
  };
}
