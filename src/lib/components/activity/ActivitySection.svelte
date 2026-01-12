<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		transactions,
		activityLoading,
		activityLoadingMore,
		activityError,
		activityHasMore,
		fetchActivity,
		loadMoreActivity,
		refreshActivity
	} from '$lib/stores/activity';
	import { evmConnected, evmAddress } from '$lib/stores/evm';
	import { starknetConnected, starknetAddress } from '$lib/stores/starknet';
	import { bridgeStep } from '$lib/stores/bridge';
	import TransactionCard from './TransactionCard.svelte';
	import ClaimCard from './ClaimCard.svelte';

	// Track if any wallet is connected
	const hasWallet = $derived($evmConnected || $starknetConnected);

	// Auto-refresh interval
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	// Fetch activity on mount and when wallets change
	onMount(() => {
		if (hasWallet) {
			fetchActivity();
		}
		// Auto-refresh every 10 seconds when a bridge is in progress
		refreshInterval = setInterval(() => {
			const step = $bridgeStep;
			if (step !== 'idle' && step !== 'completed' && step !== 'failed') {
				refreshActivity();
			}
		}, 10000);
	});

	onDestroy(() => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
	});

	$effect(() => {
		// Depend on addresses to trigger refetch
		const _evm = $evmAddress;
		const _starknet = $starknetAddress;

		if ($evmConnected || $starknetConnected) {
			fetchActivity();
		} else {
			transactions.set([]);
		}
	});

	$effect(() => {
		const step = $bridgeStep;
		if (step === 'minting' || step === 'completed') {
			setTimeout(() => refreshActivity(), 1000);
		}
	});
</script>

{#if hasWallet}
	<div class="mt-6 rounded-xl bg-gray-800 p-6">
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<h3 class="text-lg font-semibold text-white">Activity</h3>
			<button
				onclick={() => refreshActivity()}
				disabled={$activityLoading}
				class="rounded-lg p-2 text-gray-400 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
				aria-label="Refresh activity"
			>
				<svg
					class="h-5 w-5 {$activityLoading ? 'animate-spin' : ''}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
			</button>
		</div>

		<!-- Claim Card (at top) -->
		<ClaimCard />

		<!-- Loading State -->
		{#if $activityLoading}
			<div class="space-y-3">
				{#each [1, 2, 3] as _}
					<div class="animate-pulse rounded-lg bg-gray-700/50 p-4">
						<div class="flex items-start justify-between">
							<div>
								<div class="h-5 w-24 rounded bg-gray-600"></div>
								<div class="mt-2 h-4 w-32 rounded bg-gray-600"></div>
							</div>
							<div class="h-6 w-16 rounded-full bg-gray-600"></div>
						</div>
						<div class="mt-3 h-3 w-48 rounded bg-gray-600"></div>
					</div>
				{/each}
			</div>
		{:else if $activityError}
			<!-- Error State -->
			<div class="rounded-lg bg-red-500/20 p-4 text-sm text-red-400">
				<p>{$activityError}</p>
				<button
					onclick={() => fetchActivity()}
					class="mt-2 text-red-300 underline hover:no-underline"
				>
					Try again
				</button>
			</div>
		{:else if $transactions.length === 0}
			<!-- Empty State -->
			<div class="rounded-lg bg-gray-700/30 p-8 text-center">
				<svg
					class="mx-auto h-12 w-12 text-gray-500"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
					/>
				</svg>
				<p class="mt-3 text-gray-400">No transactions yet</p>
				<p class="mt-1 text-sm text-gray-500">Your bridge transactions will appear here</p>
			</div>
		{:else}
			<!-- Transaction List -->
			<div class="space-y-3">
				{#each $transactions as tx (tx.id)}
					<TransactionCard transaction={tx} />
				{/each}
			</div>

			<!-- Load More -->
			{#if $activityHasMore}
				<div class="mt-4 text-center">
					<button
						onclick={() => loadMoreActivity()}
						disabled={$activityLoadingMore}
						class="rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-600 disabled:opacity-50"
					>
						{#if $activityLoadingMore}
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
								Loading...
							</span>
						{:else}
							Load More
						{/if}
					</button>
				</div>
			{/if}
		{/if}
	</div>
{/if}
