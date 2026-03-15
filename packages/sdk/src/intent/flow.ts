import type { ChainConfig, TokenConfig } from '../config.js';
import type { CoordinatorClient } from '../coordinator.js';
import type { DraftIntentSignature } from '../types.js';
import { calculateFee } from './fee.js';
import { createDraft } from './draft.js';
import { buildIntentArguments } from './arguments.js';
import { pollForSignature, pollForFulfillment } from './polling.js';
import type {
  DraftData,
  FeeCalculationResult,
  FlowType,
  IntentArguments,
  IntentFlowConfig,
  IntentFlowEvent,
  IntentStatus,
} from './types.js';

type EventListener = (event: IntentFlowEvent) => void;

/**
 * IntentFlow orchestrates the full lifecycle of a cross-chain intent:
 *
 * 1. Calculate fee from exchange rate
 * 2. Create draft via coordinator
 * 3. Poll for solver signature
 * 4. Build Move transaction arguments
 * 5. (Caller submits on-chain transaction)
 * 6. Poll for fulfillment
 *
 * Emits IntentFlowEvent at each step. The caller is responsible for
 * signing and submitting the on-chain transaction (step 5).
 */
export class IntentFlow {
  private coordinator: CoordinatorClient;
  private configs: Record<string, ChainConfig>;
  private listeners: EventListener[] = [];
  private abortController: AbortController | null = null;

  private _status: IntentStatus = 'pending';
  private _draftId: string | null = null;
  private _draftData: DraftData | null = null;
  private _signature: DraftIntentSignature | null = null;

  constructor(config: IntentFlowConfig) {
    this.coordinator = config.coordinator;
    this.configs = config.chainConfigs;
  }

  get status(): IntentStatus { return this._status; }
  get draftId(): string | null { return this._draftId; }
  get draftData(): DraftData | null { return this._draftData; }
  get signature(): DraftIntentSignature | null { return this._signature; }

  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: IntentFlowEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Calculate fee for the given exchange rate data.
   * Pure computation — no network calls.
   */
  calculateFee(
    offeredAmount: number,
    offeredToken: TokenConfig,
    desiredToken: TokenConfig,
    exchangeRateData: {
      exchange_rate: number;
      base_fee_in_move: number;
      move_rate: number;
      fee_bps: number;
    },
  ): FeeCalculationResult {
    return calculateFee(offeredAmount, offeredToken, desiredToken, exchangeRateData);
  }

  /**
   * Create a draft intent and begin polling for a solver signature.
   * Emits 'draft_created' then 'signature_received' events.
   */
  async requestDraft(opts: {
    requesterAddr: string;
    offeredToken: TokenConfig;
    offeredAmount: number;
    offeredChainId: number;
    desiredToken: TokenConfig;
    desiredAmount: string;
    desiredChainId: number;
    flowType: FlowType;
    feeInfo: FeeCalculationResult['feeInfo'] | null;
  }): Promise<void> {
    this.abortController = new AbortController();
    this._status = 'requested';

    try {
      const { draftId, draftData } = await createDraft({
        coordinator: this.coordinator,
        ...opts,
      });

      this._draftId = draftId;
      this._draftData = draftData;
      this.emit({ type: 'draft_created', draftId, draftData });

      const sig = await pollForSignature(
        this.coordinator,
        draftId,
        { expiryTime: draftData.expiryTime, signal: this.abortController.signal },
      );

      this._signature = sig;
      this._status = 'signature_received';
      this.emit({ type: 'signature_received', signature: sig });
    } catch (error) {
      this._status = 'error';
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', error: message });
      throw error;
    }
  }

  /**
   * Build the Move entry-function arguments for the on-chain intent transaction.
   * Must be called after signature is received.
   */
  buildArguments(opts: {
    flowType: FlowType;
    requesterAddr: string;
    evmAddress?: string;
    svmPublicKey?: string;
  }): IntentArguments {
    if (!this._draftData || !this._signature) {
      throw new Error('Draft and signature must be available before building arguments');
    }

    return buildIntentArguments({
      configs: this.configs,
      draftData: this._draftData,
      signature: this._signature,
      ...opts,
    });
  }

  /**
   * Poll for fulfillment after the on-chain transaction has been submitted.
   * The caller provides the intentId (which may differ from the draft intentId
   * if the on-chain transaction assigned a different ID).
   */
  async waitForFulfillment(opts: {
    intentId: string;
    flowType: FlowType;
  }): Promise<void> {
    if (!this._draftData || !this._signature) {
      throw new Error('Draft and signature must be available before polling fulfillment');
    }

    this._status = 'created';
    const signal = this.abortController?.signal;

    try {
      await pollForFulfillment({
        configs: this.configs,
        draftData: this._draftData,
        flowType: opts.flowType,
        intentId: opts.intentId,
        solverHubAddr: this._signature.solver_hub_addr,
        signal,
      });

      this._status = 'fulfilled';
      this.emit({ type: 'fulfilled' });
    } catch (error) {
      this._status = 'error';
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', error: message });
      throw error;
    }
  }

  /**
   * Abort any in-progress polling.
   */
  abort(): void {
    this.abortController?.abort();
  }
}
