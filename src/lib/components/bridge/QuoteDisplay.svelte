<script lang="ts">
	import type { Quote } from '$lib/stores/types';

	interface Props {
		quote: Quote | null;
		loading?: boolean;
	}

	let { quote, loading = false }: Props = $props();

	function formatAmount(amount: string): string {
		const value = Number(amount) / 1e6;
		return value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 6
		});
	}
</script>

{#if loading}
	<div class="animate-pulse rounded-lg bg-gray-700/50 p-4">
		<div class="h-4 w-24 rounded bg-gray-600"></div>
		<div class="mt-2 h-6 w-32 rounded bg-gray-600"></div>
	</div>
{:else if quote}
	<div class="space-y-3 rounded-lg bg-gray-700/50 p-4">
		<div class="flex justify-between text-sm">
			<span class="text-gray-400">You'll receive</span>
			<span class="font-semibold text-white">{formatAmount(quote.outputAmount)} USDC</span>
		</div>
		<div class="flex justify-between text-sm">
			<span class="text-gray-400">Fee</span>
			<span class="text-gray-300">{formatAmount(quote.fee)} USDC</span>
		</div>
		<div class="flex justify-between text-sm">
			<span class="text-gray-400">Estimated time</span>
			<span class="text-gray-300">{quote.estimatedTime}</span>
		</div>
		<div class="flex justify-between text-sm">
			<span class="text-gray-400">Rate</span>
			<span class="text-gray-300">{quote.rate}</span>
		</div>
	</div>
{/if}
