import { signOut } from "@/lib/auth/actions";

/** Cierra la sesión con la Server Action `signOut`. Va en la banda de marca. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="inline-flex h-8 items-center rounded-md px-3 text-label font-semibold text-brand-contrast transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring-inverse"
      >
        Cerrar sesión
      </button>
    </form>
  );
}
