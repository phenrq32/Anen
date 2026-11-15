export interface FormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Dados devolvidos em caso de sucesso (ex.: link de convite). */
  data?: Record<string, string>;
}

export const initialFormState: FormState = { status: "idle" };

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
