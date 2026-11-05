import { notFound } from "next/navigation";
import JoinForm from "@/components/JoinForm";
import { deskConfig } from "@/lib/config";

/** The page itself holds nothing: the link's token stays in the browser until JoinForm sends it. */
export default function Join() {
  if (!deskConfig()) notFound();
  return <JoinForm />;
}
