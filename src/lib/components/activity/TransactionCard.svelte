<script lang="ts">
	import type { ActivityTransaction } from '$lib/stores/types';
	import {
		getChainName,
		getTxUrl,
		formatAmount,
		formatRelativeTime,
		getStatusColor,
		getStatusText,
		truncateHash
	} from '$lib/stores/activity';

	interface Props {
		transaction: ActivityTransaction;
	}

	let { transaction }: Props = $props();

	const sourceChain = $derived(getChainName(transaction.sourceDomainId));
	const destChain = $derived(getChainName(transaction.destDomainId));
	const amount = $derived(formatAmount(transaction.amount));
	const timeAgo = $derived(formatRelativeTime(transaction.createdAt));
	const statusColor = $derived(getStatusColor(transaction.status));
	const statusText = $derived(getStatusText(transaction.status));

	const burnTxUrl = $derived(
		transaction.burnTxHash
			? getTxUrl(transaction.sourceDomainId, transaction.burnTxHash)
			: undefined
	);
	const mintTxUrl = $derived(
		transaction.mintTxHash ? getTxUrl(transaction.destDomainId, transaction.mintTxHash) : undefined
	);
</script>

<div class="rounded-lg bg-gray-700/50 p-4">
	<!-- Header: Amount and Status -->
	<div class="flex items-start justify-between">
		<div>
			<span class="text-lg font-semibold text-white">{amount} USDC</span>
			<div class="mt-1 flex items-center gap-2 text-sm text-gray-400">
				<span>{sourceChain}</span>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
				<span>{destChain}</span>
			</div>
		</div>
		<span class="rounded-full px-2 py-1 text-xs font-medium {statusColor}">
			{statusText}
		</span>
	</div>

	<!-- Transaction Hashes -->
	<div class="mt-3 space-y-1 text-xs">
		{#if transaction.burnTxHash}
			<div class="flex items-center gap-2">
				<span class="text-gray-500">Burn:</span>
				{#if burnTxUrl}
					<a
						href={burnTxUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="font-mono text-blue-400 hover:text-blue-300"
					>
						{truncateHash(transaction.burnTxHash)}
					</a>
				{:else}
					<span class="font-mono text-gray-400">{truncateHash(transaction.burnTxHash)}</span>
				{/if}
			</div>
		{/if}
		{#if transaction.mintTxHash}
			<div class="flex items-center gap-2">
				<span class="text-gray-500">Mint:</span>
				{#if mintTxUrl}
					<a
						href={mintTxUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="font-mono text-blue-400 hover:text-blue-300"
					>
						{truncateHash(transaction.mintTxHash)}
					</a>
				{:else}
					<span class="font-mono text-gray-400">{truncateHash(transaction.mintTxHash)}</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Timestamp -->
	<div class="mt-2 text-xs text-gray-500">
		{timeAgo}
	</div>
</div>
