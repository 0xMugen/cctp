<script lang="ts">
	import {
		claimableTransactions,
		claimableTotalAmount,
		claimTransaction,
		claimingTxId,
		claimError,
		formatAmount,
		getChainName
	} from '$lib/stores/activity';
	import { evmConnected } from '$lib/stores/evm';

	async function handleClaim(txId: string) {
		const tx = $claimableTransactions.find((t) => t.id === txId);
		if (tx) {
			await claimTransaction(tx);
		}
	}

	const totalClaimable = $derived(formatAmount($claimableTotalAmount.toString()));
</script>

{#if $claimableTransactions.length > 0}
	<div
		class="mb-4 rounded-xl border border-green-500/30 bg-gradient-to-r from-green-500/10 to-blue-500/10 p-4"
	>
		<div class="mb-3 flex items-center gap-2">
			<svg class="h-5 w-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<span class="font-semibold text-white">USDC Ready to Claim</span>
		</div>

		<!-- Error message -->
		{#if $claimError}
			<div class="mb-3 rounded-lg bg-red-500/20 p-2 text-sm text-red-400">
				{$claimError}
			</div>
		{/if}

		<!-- Not connected warning -->
		{#if !$evmConnected}
			<div class="mb-3 rounded-lg bg-yellow-500/20 p-2 text-sm text-yellow-400">
				Connect your EVM wallet to claim
			</div>
		{/if}

		<!-- List of claimable transactions -->
		<div class="space-y-2">
			{#each $claimableTransactions as tx (tx.id)}
				<div class="flex items-center justify-between rounded-lg bg-gray-800/50 p-3">
					<div>
						<span class="font-medium text-white">{formatAmount(tx.amount)} USDC</span>
						<span class="ml-2 text-sm text-gray-400">on {getChainName(tx.destDomainId)}</span>
					</div>
					<button
						onclick={() => handleClaim(tx.id)}
						disabled={$claimingTxId !== null || !$evmConnected}
						class="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if $claimingTxId === tx.id}
							<span class="flex items-center gap-2">
								<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									></circle>
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									></path>
								</svg>
								Claiming...
							</span>
						{:else}
							Claim
						{/if}
					</button>
				</div>
			{/each}
		</div>

		<!-- Summary -->
		{#if $claimableTransactions.length > 1}
			<div class="mt-3 border-t border-gray-700 pt-3 text-sm text-gray-400">
				Total: <span class="font-medium text-white">{totalClaimable} USDC</span> across
				{$claimableTransactions.length} transactions
			</div>
		{/if}
	</div>
{/if}
