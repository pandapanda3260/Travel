import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyDirectorVideoGenerationPage() {
  redirect("/studio/video-generation");
}
