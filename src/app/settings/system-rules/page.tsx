import { redirect } from "next/navigation";

export default function SystemRulesPage() {
  redirect("/settings/constraint-prompts?tab=overview");
}
