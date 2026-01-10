<script lang="ts">
	import {
		evmConnected,
		evmAddress,
		evmConnecting,
		evmError,
		connectEvm,
		disconnectEvm,
		truncateEvmAddress
	} from '$lib/stores/evm';
</script>

{#if $evmConnected && $evmAddress}
	<button
		onclick={() => disconnectEvm()}
		class="flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-600"
	>
		<span class="h-2 w-2 rounded-full bg-green-500"></span>
		{truncateEvmAddress($evmAddress)}
	</button>
{:else}
	<div class="flex flex-col items-end gap-1">
		<button
			onclick={() => connectEvm()}
			disabled={$evmConnecting}
			class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if $evmConnecting}
				Connecting...
			{:else}
				Connect EVM
			{/if}
		</button>
		{#if $evmError}
			<span class="text-xs text-red-400">{$evmError}</span>
		{/if}
	</div>
{/if}
