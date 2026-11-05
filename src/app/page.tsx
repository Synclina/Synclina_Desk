import { notFound, redirect } from "next/navigation";
import SignInForm from "@/components/SignInForm";
import { deskConfig } from "@/lib/config";
import { currentStaff } from "@/lib/session";

export default async function SignIn() {
  if (!deskConfig()) notFound();
  if (await currentStaff()) redirect("/home");
  return <SignInForm />;
}
