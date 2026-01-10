<script lang="ts">
	import EvmConnectButton from '$lib/components/wallet/EvmConnectButton.svelte';
	import StarknetConnectButton from '$lib/components/wallet/StarknetConnectButton.svelte';
	import ChainSelector from '$lib/components/bridge/ChainSelector.svelte';
	import AmountInput from '$lib/components/bridge/AmountInput.svelte';
	import QuoteDisplay from '$lib/components/bridge/QuoteDisplay.svelte';
	import TransactionStatus from '$lib/components/bridge/TransactionStatus.svelte';
	import {
		chainsLoaded,
		sourceChain,
		destChain,
		bridgeAmount,
		currentQuote,
		quoteFetching,
		bridgeStep,
		availableSourceChains,
		availableDestChains,
		setSourceChain,
		setDestChain,
		swapChains,
		fetchQuote,
		getBridgeStepLabel
	} from '$lib/stores/bridge';
	import { evmConnected } from '$lib/stores/evm';
	import { starknetConnected } from '$lib/stores/starknet';
	import { executeBridge } from '$lib/bridge/executor';

	let quoteTimeout: ReturnType<typeof setTimeout> | null = null;

	// Fetch quote when inputs change (debounced)
	$effect(() => {
		if ($sourceChain && $destChain && $bridgeAmount && parseFloat($bridgeAmount) > 0) {
			if (quoteTimeout) clearTimeout(quoteTimeout);
			quoteTimeout = setTimeout(() => {
				fetchQuote();
			}, 500);
		}
	});

	const needsEvmWallet = $derived($sourceChain?.type === 'evm' || $destChain?.type === 'evm');
	const needsStarknetWallet = $derived(
		$sourceChain?.type === 'starknet' || $destChain?.type === 'starknet'
	);

	const canBridge = $derived(
		$sourceChain &&
			$destChain &&
			$bridgeAmount &&
			parseFloat($bridgeAmount) > 0 &&
			$currentQuote &&
			$bridgeStep === 'idle' &&
			(!needsEvmWallet || $evmConnected) &&
			(!needsStarknetWallet || $starknetConnected)
	);

	async function handleBridge() {
		if (!canBridge || !$sourceChain || !$destChain) return;

		await executeBridge({
			sourceChain: $sourceChain,
			destChain: $destChain,
			amount: $bridgeAmount
		});
	}

	// Handle amount input
	function handleAmountInput(value: string) {
		bridgeAmount.set(value);
	}
</script>

<svelte:head>
	<title>CCTP Bridge</title>
	<meta name="description" content="Cross-Chain Transfer Protocol bridging with Circle" />
</svelte:head>

<main class="flex min-h-screen flex-col bg-gray-900 text-white">
	<!-- Header -->
	<header class="border-b border-gray-800 px-4 py-4">
		<div class="mx-auto flex max-w-lg items-center justify-between">
			<h1 class="text-xl font-bold">CCTP Bridge</h1>
			<div class="flex gap-2">
				<EvmConnectButton />
				<StarknetConnectButton />
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<div class="flex-1 px-4 py-8">
		<div class="mx-auto max-w-lg">
			{#if !$chainsLoaded}
				<!-- Loading state -->
				<div class="rounded-xl bg-gray-800 p-8 text-center">
					<div
						class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
					></div>
					<p class="mt-4 text-gray-400">Loading bridge configuration...</p>
				</div>
			{:else}
				<!-- Bridge Form -->
				<div class="rounded-xl bg-gray-800 p-6">
					<!-- Source Chain -->
					<ChainSelector
						label="From"
						chains={$availableSourceChains}
						selected={$sourceChain}
						onSelect={setSourceChain}
						disabled={$bridgeStep !== 'idle'}
					/>

					<!-- Amount Input -->
					<div class="mt-4">
						<AmountInput
							value={$bridgeAmount}
							onInput={handleAmountInput}
							disabled={$bridgeStep !== 'idle'}
						/>
					</div>

					<!-- Swap Button -->
					<div class="my-4 flex justify-center">
						<button
							onclick={() => swapChains()}
							disabled={$bridgeStep !== 'idle'}
							class="rounded-full bg-gray-700 p-2 text-gray-400 transition hover:bg-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
								/>
							</svg>
						</button>
					</div>

					<!-- Destination Chain -->
					<ChainSelector
						label="To"
						chains={$availableDestChains}
						selected={$destChain}
						onSelect={setDestChain}
						disabled={$bridgeStep !== 'idle'}
					/>

					<!-- Quote Display -->
					<div class="mt-4">
						<QuoteDisplay quote={$currentQuote} loading={$quoteFetching} />
					</div>

					<!-- Wallet Connection Hints -->
					{#if needsEvmWallet && !$evmConnected}
						<div class="mt-4 rounded-lg bg-blue-500/20 p-3 text-sm text-blue-400">
							Please connect your EVM wallet to continue
						</div>
					{/if}
					{#if needsStarknetWallet && !$starknetConnected}
						<div class="mt-4 rounded-lg bg-orange-500/20 p-3 text-sm text-orange-400">
							Please connect your Starknet wallet to continue
						</div>
					{/if}

					<!-- Bridge Button -->
					<button
						onclick={handleBridge}
						disabled={!canBridge}
						class="mt-6 w-full rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 py-4 text-lg font-semibold transition hover:from-blue-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:from-gray-600 disabled:to-gray-600 disabled:opacity-50"
					>
						{getBridgeStepLabel($bridgeStep)}
					</button>
				</div>

				<!-- Transaction Status -->
				<TransactionStatus />

				<!-- Info Section -->
				<div class="mt-6 rounded-xl bg-gray-800/50 p-4 text-sm text-gray-400">
					<h3 class="mb-2 font-medium text-white">About CCTP</h3>
					<p>
						Circle's Cross-Chain Transfer Protocol (CCTP) enables native USDC transfers between
						supported chains. Starknet must be either the source or destination for all bridges.
					</p>
					<p class="mt-2">V2 Fast Transfer typically completes in under 30 seconds.</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Footer -->
	<footer class="border-t border-gray-800 px-4 py-4 text-center text-sm text-gray-500">
		Powered by Circle CCTP V2
	</footer>
</main>
