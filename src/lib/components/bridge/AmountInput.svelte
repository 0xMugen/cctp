<script lang="ts">
	interface Props {
		value: string;
		onInput: (value: string) => void;
		disabled?: boolean;
	}

	let { value, onInput, disabled = false }: Props = $props();

	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		// Only allow numbers and one decimal point
		let newValue = target.value.replace(/[^0-9.]/g, '');

		// Ensure only one decimal point
		const parts = newValue.split('.');
		if (parts.length > 2) {
			newValue = parts[0] + '.' + parts.slice(1).join('');
		}

		// Limit to 6 decimal places (USDC precision)
		if (parts.length === 2 && parts[1].length > 6) {
			newValue = parts[0] + '.' + parts[1].slice(0, 6);
		}

		onInput(newValue);
	}
</script>

<div class="space-y-2">
	<label class="block text-sm font-medium text-gray-400">Amount</label>
	<div class="relative">
		<input
			type="text"
			inputmode="decimal"
			placeholder="0.00"
			{value}
			oninput={handleInput}
			{disabled}
			class="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-3 pr-20 text-xl font-semibold text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
		/>
		<div class="absolute inset-y-0 right-0 flex items-center pr-4">
			<span class="font-medium text-gray-400">USDC</span>
		</div>
	</div>
</div>
