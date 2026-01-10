<script lang="ts">
	import type { ChainConfig } from '$lib/stores/types';

	interface Props {
		label: string;
		chains: ChainConfig[];
		selected: ChainConfig | null;
		onSelect: (chain: ChainConfig) => void;
		disabled?: boolean;
	}

	let { label, chains, selected, onSelect, disabled = false }: Props = $props();

	function handleChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		const chain = chains.find((c) => c.domainId === Number(target.value));
		if (chain) {
			onSelect(chain);
		}
	}

	// Chain type badge color
	function getChainColor(type: string): string {
		switch (type) {
			case 'starknet':
				return 'bg-orange-500';
			case 'evm':
				return 'bg-blue-500';
			default:
				return 'bg-gray-500';
		}
	}
</script>

<div class="space-y-2">
	<label class="block text-sm font-medium text-gray-400">{label}</label>
	<div class="relative">
		<select
			value={selected?.domainId ?? ''}
			onchange={handleChange}
			{disabled}
			class="w-full appearance-none rounded-lg border border-gray-600 bg-gray-700 px-4 py-3 pr-10 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<option value="">Select chain</option>
			{#each chains as chain}
				<option value={chain.domainId}>
					{chain.name}
				</option>
			{/each}
		</select>
		<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
			<svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</div>
	</div>
	{#if selected}
		<div class="flex items-center gap-2 text-sm text-gray-400">
			<span class="h-2 w-2 rounded-full {getChainColor(selected.type)}"></span>
			<span class="capitalize">{selected.type}</span>
			{#if selected.type === 'starknet'}
				<span class="text-orange-400">(required)</span>
			{/if}
		</div>
	{/if}
</div>
