/**
 * Validação estrutural de números fiscais (dígitos de controlo).
 * Confirma apenas que o número é bem formado. Não confirma que existe nem a quem pertence:
 * isso exige consulta às autoridades (AT / Receita Federal), prevista para fases seguintes.
 */

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s.\-/]/g, "").toUpperCase();
}

/** NIF/NIPC português: 9 dígitos, dígito de controlo módulo 11. */
export function isValidPortugueseNif(value: string): boolean {
  const nif = normalizeTaxId(value);
  if (!/^\d{9}$/.test(nif)) return false;
  // Prefixos atribuídos: pessoas singulares (1,2,3), coletivas (5), públicas (6), heranças/outros (7x, 8, 9x)
  if (!/^(1|2|3|5|6|8|45|70|71|72|74|75|77|79|90|91|98|99)/.test(nif)) return false;
  let total = 0;
  for (let i = 0; i < 8; i++) total += Number(nif[i]) * (9 - i);
  const remainder = total % 11;
  const check = remainder < 2 ? 0 : 11 - remainder;
  return check === Number(nif[8]);
}

/** CPF brasileiro: 11 dígitos com dois dígitos verificadores. */
export function isValidCpf(value: string): boolean {
  const cpf = normalizeTaxId(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number): number => {
    let total = 0;
    for (let i = 0; i < length; i++) total += Number(cpf[i]) * (length + 1 - i);
    return ((total * 10) % 11) % 10;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/**
 * CNPJ brasileiro, incluindo o formato alfanumérico (IN RFB nº 2.229/2024, em vigor a partir de julho de 2026):
 * 12 caracteres alfanuméricos + 2 dígitos verificadores numéricos. Valor de cada carácter = código ASCII - 48.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeTaxId(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const values = [...cnpj].map((c) => c.charCodeAt(0) - 48);
  const digit = (length: number): number => {
    let total = 0;
    let weight = 2;
    for (let i = length - 1; i >= 0; i--) {
      total += (values[i] ?? 0) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(12) === values[12] && digit(13) === values[13];
}

/** Valida o número fiscal de uma organização segundo o país. */
export function isValidOrganizationTaxId(countryCode: string, value: string): boolean {
  switch (countryCode) {
    case "PT":
      return isValidPortugueseNif(value);
    case "BR":
      // Profissionais independentes no Brasil podem operar com CPF (ex.: autónomos); empresas e MEI com CNPJ.
      return isValidCnpj(value) || isValidCpf(value);
    default:
      return false;
  }
}
