<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { wagmiConfig, syncEvmState } from '$lib/stores/evm';
	import { initStarknet } from '$lib/stores/starknet';
	import { loadChains } from '$lib/stores/bridge';

	let { children } = $props();

	onMount(async () => {
		try {
			const { createConfig, http } = await import('@wagmi/core');
			const { injected } = await import('@wagmi/connectors');
			const { mainnet, optimism, arbitrum, base, polygon } = await import('@wagmi/core/chains');

			const config = createConfig({
				chains: [mainnet, optimism, arbitrum, base, polygon],
				connectors: [
					injected() // MetaMask, Coinbase Wallet, etc.
				],
				transports: {
					[mainnet.id]: http(),
					[optimism.id]: http(),
					[arbitrum.id]: http(),
					[base.id]: http(),
					[polygon.id]: http()
				}
			});

			wagmiConfig.set(config);

			// Watch for account changes
			const { watchAccount } = await import('@wagmi/core');
			watchAccount(config, {
				onChange: (account) => {
					syncEvmState(account.address, account.chainId, account.isConnected);
				}
			});

			// Reconnect on page load
			const { reconnect } = await import('@wagmi/core');
			await reconnect(config);
		} catch (error) {
			console.error('Failed to initialize wagmi:', error);
		}

		await initStarknet();

		// Load bridge chains
		await loadChains();
	});
</script>

{@render children()}
