<script lang="ts">
	import EvmConnectButton from '$lib/components/wallet/EvmConnectButton.svelte';
	import StarknetConnectButton from '$lib/components/wallet/StarknetConnectButton.svelte';
	import ChainSelector from '$lib/components/bridge/ChainSelector.svelte';
	import AmountInput from '$lib/components/bridge/AmountInput.svelte';
	import QuoteDisplay from '$lib/components/bridge/QuoteDisplay.svelte';
	import TransactionStatus from '$lib/components/bridge/TransactionStatus.svelte';
	import ActivitySection from '$lib/components/activity/ActivitySection.svelte';
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
		getBridgeStepLabel,
		isFastTransfer,
		resetBridge
	} from '$lib/stores/bridge';
	import { evmConnected, evmAddress } from '$lib/stores/evm';
	import { starknetConnected, starknetAddress } from '$lib/stores/starknet';
	import { executeBridge } from '$lib/bridge/executor';
	import { fetchSourceBalance } from '$lib/stores/balance';

	let quoteTimeout: ReturnType<typeof setTimeout> | null = null;
	let showBridgeAgain = $state(false);

	// Fetch quote when inputs change (debounced)
	$effect(() => {
		// Access isFastTransfer to create dependency - quote updates when toggled
		const fast = $isFastTransfer;
		if ($sourceChain && $destChain && $bridgeAmount && parseFloat($bridgeAmount) > 0) {
			if (quoteTimeout) clearTimeout(quoteTimeout);
			quoteTimeout = setTimeout(() => {
				fetchQuote();
			}, 500);
		}
	});

	$effect(() => {
		if ($bridgeStep === 'completed') {
			// Refresh balance after bridge completes
			fetchSourceBalance();
			const timeout = setTimeout(() => {
				showBridgeAgain = true;
			}, 2000);
			return () => clearTimeout(timeout);
		} else {
			showBridgeAgain = false;
		}
	});

	$effect(() => {
		const chain = $sourceChain;
		const evm = $evmAddress;
		const sn = $starknetAddress;
		if (chain) {
			fetchSourceBalance();
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
			($bridgeStep === 'idle' || $bridgeStep === 'failed') &&
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
						disabled={$bridgeStep !== 'idle' && $bridgeStep !== 'failed'}
					/>

					<!-- Amount Input -->
					<div class="mt-4">
						<AmountInput
							value={$bridgeAmount}
							onInput={handleAmountInput}
							disabled={$bridgeStep !== 'idle' && $bridgeStep !== 'failed'}
						/>
					</div>

					<!-- Fast Transfer Toggle -->
					<div class="mt-4">
						<div class="flex items-center justify-between rounded-lg bg-gray-700/50 p-4">
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium text-white">Fast Transfer</span>
									{#if $isFastTransfer}
										<span
											class="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400"
										>
											~30 sec
										</span>
									{/if}
								</div>
								{#if $isFastTransfer}
									<p class="mt-1 text-xs text-yellow-400">
										Transfer takes only a few seconds but extra fees may apply
									</p>
								{:else}
									<p class="mt-1 text-xs text-gray-400">Standard finality (~2-5 minutes)</p>
								{/if}
							</div>
							<button
								type="button"
								onclick={() => isFastTransfer.update((v) => !v)}
								disabled={$bridgeStep !== 'idle' && $bridgeStep !== 'failed'}
								class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {$isFastTransfer
									? 'bg-blue-600'
									: 'bg-gray-600'}"
								role="switch"
								aria-checked={$isFastTransfer}
								aria-label="Toggle fast transfer mode"
							>
								<span
									class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {$isFastTransfer
										? 'translate-x-5'
										: 'translate-x-0'}"
								></span>
							</button>
						</div>
					</div>

					<!-- Swap Button -->
					<div class="my-4 flex justify-center">
						<button
							onclick={() => swapChains()}
							disabled={$bridgeStep !== 'idle' && $bridgeStep !== 'failed'}
							aria-label="Swap source and destination chains"
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
						disabled={$bridgeStep !== 'idle' && $bridgeStep !== 'failed'}
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
					{#if showBridgeAgain}
						<button
							onclick={() => resetBridge()}
							class="mt-6 w-full rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 py-4 text-lg font-semibold transition hover:from-green-500 hover:to-emerald-500"
						>
							Bridge Again
						</button>
					{:else}
						<button
							onclick={handleBridge}
							disabled={!canBridge}
							class="mt-6 w-full rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 py-4 text-lg font-semibold transition hover:from-blue-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:from-gray-600 disabled:to-gray-600 disabled:opacity-50"
						>
							{getBridgeStepLabel($bridgeStep)}
						</button>
					{/if}
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

				<!-- Activity Section -->
				<ActivitySection />
			{/if}
		</div>
	</div>

	<!-- Footer -->
	<footer class="border-t border-gray-800 px-4 py-4 text-center text-sm text-gray-500">
		Powered by Circle CCTP V2
	</footer>
</main>
