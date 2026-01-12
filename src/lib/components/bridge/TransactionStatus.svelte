<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		activeBridgeId,
		bridgeStatus,
		bridgeStep,
		bridgeError,
		connectSSE,
		sseConnection,
		resetBridge
	} from '$lib/stores/bridge';
	import type { BridgeStep } from '$lib/stores/types';

	// Connect to SSE when bridge ID changes
	$effect(() => {
		if ($activeBridgeId) {
			connectSSE($activeBridgeId);
		}
	});

	// Cleanup SSE on unmount
	onDestroy(() => {
		const sse = $sseConnection;
		if (sse) {
			sse.close();
		}
	});

	// Step definitions
	const steps: { key: BridgeStep | 'burned' | 'attested'; label: string }[] = [
		{ key: 'initiating', label: 'Initiated' },
		{ key: 'burning', label: 'Burning' },
		{ key: 'waiting_attestation', label: 'Attesting' },
		{ key: 'minting', label: 'Minting' },
		{ key: 'completed', label: 'Completed' }
	];

	function isStepComplete(step: string): boolean {
		const stepOrder = [
			'idle',
			'initiating',
			'burning',
			'waiting_attestation',
			'minting',
			'completed'
		];
		const currentIndex = stepOrder.indexOf($bridgeStep);
		const stepIndex = stepOrder.indexOf(step);
		return stepIndex < currentIndex;
	}

	function isStepCurrent(step: string): boolean {
		return $bridgeStep === step;
	}

	function truncateTxHash(hash: string): string {
		return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
	}
</script>

{#if $activeBridgeId}
	<div class="mt-6 rounded-xl bg-gray-800 p-6">
		<div class="mb-4">
			<h3 class="text-lg font-semibold text-white">Transaction Status</h3>
		</div>

		<!-- Progress Steps -->
		<div class="mb-6">
			<div class="flex justify-between">
				{#each steps as step, i}
					<div class="flex flex-col items-center">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium
                {isStepComplete(step.key)
								? 'bg-green-500 text-white'
								: isStepCurrent(step.key)
									? 'animate-pulse bg-blue-500 text-white'
									: 'bg-gray-600 text-gray-400'}"
						>
							{#if isStepComplete(step.key)}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							{:else}
								{i + 1}
							{/if}
						</div>
						<span class="mt-2 text-xs text-gray-400">{step.label}</span>
					</div>
					{#if i < steps.length - 1}
						<div class="mt-4 flex-1 border-t border-gray-600"></div>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Transaction Details -->
		{#if $bridgeStatus}
			<div class="space-y-2 text-sm">
				{#if $bridgeStatus.burnTxHash}
					<div class="flex justify-between">
						<span class="text-gray-400">Burn TX:</span>
						<span class="font-mono text-gray-300">{truncateTxHash($bridgeStatus.burnTxHash)}</span>
					</div>
				{/if}
				{#if $bridgeStatus.mintTxHash}
					<div class="flex justify-between">
						<span class="text-gray-400">Mint TX:</span>
						<span class="font-mono text-gray-300">{truncateTxHash($bridgeStatus.mintTxHash)}</span>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Error Message -->
		{#if $bridgeError || $bridgeStatus?.errorMessage}
			<div class="mt-4 rounded-lg bg-red-500/20 p-3 text-sm text-red-400">
				{$bridgeError || $bridgeStatus?.errorMessage}
			</div>
		{/if}

		<!-- Success Message -->
		{#if $bridgeStep === 'completed'}
			<div class="mt-4 rounded-lg bg-green-500/20 p-3 text-sm text-green-400">
				Bridge completed successfully!
			</div>
		{/if}
	</div>
{/if}
