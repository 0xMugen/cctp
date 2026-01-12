<script lang="ts">
	import {
		starknetConnected,
		starknetAddress,
		starknetConnecting,
		connectStarknet,
		disconnectStarknet,
		truncateStarknetAddress
	} from '$lib/stores/starknet';
</script>

{#if $starknetConnected && $starknetAddress}
	<button
		onclick={() => disconnectStarknet()}
		class="flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-600"
	>
		<span class="h-2 w-2 rounded-full bg-orange-500"></span>
		{truncateStarknetAddress($starknetAddress)}
	</button>
{:else}
	<button
		onclick={() => connectStarknet()}
		disabled={$starknetConnecting}
		class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{#if $starknetConnecting}
			Connecting...
		{:else}
			Connect Starknet
		{/if}
	</button>
{/if}
