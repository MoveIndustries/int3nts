import type { TokenConfig } from '../config.js';
import { toSmallestUnits } from '../config.js';
import { BPS_DENOMINATOR, BPS_ROUNDING_OFFSET } from './constants.js';
import type { FeeCalculationResult, FeeInfo } from './types.js';

/**
 * Calculate fee and desired amount from exchange rate response.
 *
 * Takes the solver's exchange rate response and computes:
 * - minFeeOffered: base fee in MOVE converted to offered token units
 * - bpsFee: basis-points fee on the offered amount
 * - totalFee: minFeeOffered + bpsFee
 * - desiredAmount: offered amount minus fee, converted at exchange rate
 */
export function calculateFee(
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
  const { exchange_rate, base_fee_in_move, move_rate, fee_bps } = exchangeRateData;

  // Convert base_fee_in_move from MOVE to offered token: ceil(base_fee_in_move * move_rate)
  const minFeeOffered = base_fee_in_move > 0 && move_rate > 0
    ? BigInt(Math.ceil(base_fee_in_move * move_rate))
    : BigInt(0);

  // Calculate bps fee in smallest units of the offered token
  const offeredSmallest = BigInt(toSmallestUnits(offeredAmount, offeredToken.decimals).toString());
  const bpsFee = fee_bps > 0
    ? (offeredSmallest * BigInt(fee_bps) + BPS_ROUNDING_OFFSET) / BPS_DENOMINATOR
    : BigInt(0);
  const totalFee = minFeeOffered + bpsFee;

  const feeInfo: FeeInfo = { minFee: Number(minFeeOffered), feeBps: fee_bps, totalFee };

  // Calculate desired amount: deduct fee from offered amount, then apply exchange rate
  const feeInHuman = Number(totalFee) / Math.pow(10, offeredToken.decimals);
  const offeredAfterFee = offeredAmount - feeInHuman;
  if (offeredAfterFee <= 0) {
    return { feeInfo, desiredAmount: '0' };
  }
  const decimalAdjustment = Math.pow(10, offeredToken.decimals - desiredToken.decimals);
  const desiredAmountNum = (offeredAfterFee * decimalAdjustment) / exchange_rate;

  return { feeInfo, desiredAmount: desiredAmountNum.toFixed(desiredToken.decimals) };
}
