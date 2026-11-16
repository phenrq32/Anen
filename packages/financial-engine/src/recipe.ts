import { compareDecimal, decimal, divideRounded, multiplyDecimal, pow10, rescale, type Decimal } from "./decimal";
import { MoneyError, add, moneyFromMinor, percentOf, sum, type Money } from "./money";
import { priceFromMargin } from "./formulas";

/**
 * Ficha técnica de restauração: custo de um prato por dose, food cost e preços sugeridos.
 *
 * Ingrediente: compra-se `packageQuantity` (ex.: 1000 g) por `packagePriceMinor`; usa-se
 * `quantity` na receita; `wastePercent` é a perda na preparação (cascas, aparas, evaporação).
 * Quantidade comprada necessária = quantidade usada / (1 - desperdício).
 */
export interface IngredientInput {
  quantity: string;
  packageQuantity: string;
  packagePriceMinor: bigint;
  wastePercent: string;
}

export interface RecipeInput {
  currency: string;
  portions: string;
  ingredients: IngredientInput[];
  /** Custos por receita completa: energia, água, mão de obra, embalagens, indiretos. */
  extraCostsMinor: bigint[];
  /** Food cost alvo em % (ex.: 30) — preço recomendado = custo de ingredientes por dose / food cost. */
  targetFoodCostPercent: string;
  /** Margem mínima sobre o preço (ex.: 0 = cobre custos) para o preço mínimo. */
  minimumMarginPercent: string;
  taxRatePercent: string;
}

export interface RecipeBreakdown {
  ingredientCosts: Money[];
  ingredientsTotal: Money;
  extrasTotal: Money;
  totalCost: Money;
  costPerPortion: Money;
  ingredientCostPerPortion: Money;
  minimumPrice: Money;
  recommendedPrice: Money;
  recommendedPriceWithTax: Money;
  /** Food cost real do preço recomendado (ingredientes / preço), % com 2 casas. */
  foodCostPercent: Decimal | null;
}

function positive(value: Decimal, label: string): Decimal {
  if (value.coefficient <= 0n) throw new MoneyError(`${label} tem de ser positivo`);
  return value;
}

export function ingredientCost(input: IngredientInput, currency: string): Money {
  const used = decimal(input.quantity);
  const pack = positive(decimal(input.packageQuantity), "Quantidade da embalagem");
  const waste = decimal(input.wastePercent);
  if (used.coefficient < 0n || input.packagePriceMinor < 0n) throw new MoneyError("Valores negativos");
  if (waste.coefficient < 0n || compareDecimal(waste, decimal("100")) >= 0) throw new MoneyError("Desperdício entre 0 e 100 %");
  // custo = preço × usado / embalagem / (1 - desperdício/100)
  const numerator = multiplyDecimal({ coefficient: input.packagePriceMinor, scale: 0 }, used);
  const s = Math.max(numerator.scale, pack.scale, waste.scale);
  const n = rescale(numerator, s).coefficient * 100n * pow10(waste.scale);
  const d = rescale(pack, s).coefficient * (100n * pow10(waste.scale) - waste.coefficient);
  return moneyFromMinor(divideRounded(n, d, "half-up"), currency);
}

export function computeRecipe(input: RecipeInput): RecipeBreakdown {
  const { currency } = input;
  const portions = positive(decimal(input.portions), "Número de doses");
  const target = positive(decimal(input.targetFoodCostPercent), "Food cost alvo");
  if (compareDecimal(target, decimal("100")) > 0) throw new MoneyError("Food cost alvo até 100 %");

  const ingredientCosts = input.ingredients.map((i) => ingredientCost(i, currency));
  const ingredientsTotal = sum(ingredientCosts, currency);
  const extrasTotal = sum(input.extraCostsMinor.map((c) => moneyFromMinor(c, currency)), currency);
  const totalCost = add(ingredientsTotal, extrasTotal);

  const perPortion = (m: Money): Money =>
    moneyFromMinor(divideRounded(m.amountMinor * pow10(portions.scale), portions.coefficient, "half-up"), currency);
  const costPerPortion = perPortion(totalCost);
  const ingredientCostPerPortion = perPortion(ingredientsTotal);

  const minimumPrice = priceFromMargin(costPerPortion, input.minimumMarginPercent, "up");
  // preço recomendado = ingredientes por dose / food cost; nunca abaixo do preço mínimo
  const byFoodCost = moneyFromMinor(
    divideRounded(ingredientCostPerPortion.amountMinor * 100n * pow10(target.scale), target.coefficient, "up"),
    currency,
  );
  const recommendedPrice = byFoodCost.amountMinor > minimumPrice.amountMinor ? byFoodCost : minimumPrice;
  const recommendedPriceWithTax = add(recommendedPrice, percentOf(recommendedPrice, input.taxRatePercent, "half-up"));
  const foodCostPercent =
    recommendedPrice.amountMinor === 0n
      ? null
      : { coefficient: divideRounded(ingredientCostPerPortion.amountMinor * 10000n, recommendedPrice.amountMinor, "half-up"), scale: 2 };

  return {
    ingredientCosts,
    ingredientsTotal,
    extrasTotal,
    totalCost,
    costPerPortion,
    ingredientCostPerPortion,
    minimumPrice,
    recommendedPrice,
    recommendedPriceWithTax,
    foodCostPercent,
  };
}
