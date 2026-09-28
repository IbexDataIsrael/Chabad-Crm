"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/components/LanguageToggle";
import { PhotoGallery } from "@/components/public/PhotoGallery";
import { ActivistRegisterForm, OrgSignInForm } from "@/components/public/PublicAuthForms";
import { WaveRule } from "@/components/public/WaveRule";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { setPageOrg } from "@/lib/pageOrg";
import type { PublicOrg } from "@/lib/types";

type Mode = "join" | "signin";

/** fixes65 §1: an organization's branded public page — name, subtitle and
 *  photo gallery (all edited from Settings, no deploy), with inline
 *  activist registration (when the org's switch is on) and sign-in.
 *  fixes69 §Bug2: split out of page.tsx, which now only holds the server-
 *  side generateMetadata() (real OG/Twitter tags need a server component). */
export function OrgPageClient() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { t } = useLocalization();
  const { user, loading: authLoading } = useAuth();
  const [org, setOrg] = useState<PublicOrg | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<Mode>("join");

  useEffect(() => {
    apiFetch<PublicOrg>(`/api/public/orgs/${encodeURIComponent(slug)}`)
      .then((o) => {
        setOrg(o);
        if (!o.self_registration_enabled) setMode("signin");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setMissing(true);
      });
  }, [slug]);

  // The browser tab shows this org's name + logo (TitleManager owns both).
  useEffect(() => {
    setPageOrg(org ? { name: org.name, logoUrl: org.logo_url } : null);
    return () => setPageOrg(null);
  }, [org]);

  if (missing) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center bg-[#EEF6F8] px-4">
        <div className="max-w-sm text-center">
          <WaveRule className="mx-auto mb-4 h-4 w-28" color="#1692C0" />
          <p className="text-lg font-medium text-[#13232B]">
            {t("public.org_not_found", "לא מצאנו דף ארגון בכתובת הזו.")}
          </p>
          <Link href="/" className="mt-3 inline-block text-sm text-[#1692C0] underline-offset-4 hover:underline">
            {t("public.go_to_login", "למסך ההתחברות")}
          </Link>
        </div>
      </main>
    );
  }

  if (!org) {
    return <main className="min-h-[70vh] bg-[#EEF6F8]" aria-busy="true" />;
  }

  const signedInHere = !authLoading && user && user.organization_id === org.id;
  const canJoin = org.self_registration_enabled;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1692C0] ${
      active ? "bg-white text-[#0E3B4A] shadow-sm" : "text-[#13232B]/60 hover:text-[#13232B]"
    }`;

  const panel = (
    <section
      aria-label={t("public.access_panel", "הצטרפות והתחברות")}
      className="rounded-2xl bg-white p-5 shadow-[0_12px_40px_-12px_rgba(14,59,74,0.35)] sm:p-7"
    >
      {signedInHere ? (
        <div className="space-y-4 text-center">
          <p className="text-[15px] text-[#13232B]">
            {t("public.signed_in_as", "את/ה מחובר/ת כ־{name}.").replace(
              "{name}",
              user.display_name || user.full_name,
            )}
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full rounded-lg bg-[#D99A2B] px-4 py-3 font-semibold text-[#13232B] hover:bg-[#C98A1D]"
          >
            {t("public.open_system", "כניסה למערכת")}
          </button>
        </div>
      ) : (
        <>
          {canJoin && (
            <div className="mb-6 flex gap-1 rounded-lg bg-[#EEF6F8] p-1" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "join"} className={tabClass(mode === "join")} onClick={() => setMode("join")}>
                {t("public.tab_join", "הצטרפות כפעיל")}
              </button>
              <button type="button" role="tab" aria-selected={mode === "signin"} className={tabClass(mode === "signin")} onClick={() => setMode("signin")}>
                {t("public.tab_signin", "כבר רשום? התחברות")}
              </button>
            </div>
          )}
          {mode === "join" && canJoin ? (
            <>
              <p className="mb-5 text-[15px] leading-relaxed text-[#13232B]/75">
                {t(
                  "public.join_intro",
                  "ממלאים את הפרטים ומתחילים מיד — בלי המתנה לאישור. המשימות שתקבלו יופיעו באזור האישי שלכם.",
                )}
              </p>
              <ActivistRegisterForm orgSlug={org.slug} onRegistered={() => router.push("/dashboard")} />
            </>
          ) : (
            <OrgSignInForm organizationId={org.id} onSignedIn={() => router.push("/dashboard")} />
          )}
        </>
      )}
    </section>
  );

  return (
    <main className="min-h-screen bg-[#EEF6F8] text-[#13232B]">
      {/* Mobile: the gallery is the hero, the name sits on it, the panel
          rides up over its bottom edge. Desktop: name + panel on the
          reading-start side, the gallery large beside them. */}
      <div className="lg:hidden">
        <div className="relative">
          <PhotoGallery
            images={org.gallery}
            orgName={org.name}
            frameClassName="h-[58vh] min-h-[340px]"
            showThumbnails={false}
          />
          {/* Name + subtitle over the photo; pointer-events off so swipes and
              the gallery's own buttons still reach the photo underneath. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[58vh] min-h-[340px] flex-col justify-end bg-gradient-to-t from-[#0E3B4A] via-[#0E3B4A]/35 to-transparent px-5 pb-14">
            {org.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="absolute start-4 top-4 h-11 w-11 rounded-lg bg-white/90 object-contain p-1" />
            )}
            <h1 className="font-[family-name:var(--font-frank-ruhl)] text-[2.6rem] font-black leading-[1.05] text-white">
              {org.name}
            </h1>
            <WaveRule className="mt-3 h-3.5 w-32" />
            {org.subtitle && (
              <p className="mt-3 max-w-[36ch] text-[15px] leading-relaxed text-white/85">{org.subtitle}</p>
            )}
          </div>
        </div>
        <div className="relative z-10 -mt-8 px-4 pb-10">
          {panel}
          <div className="mt-6 flex justify-center">
            <LanguageToggle />
          </div>
        </div>
      </div>

      <div className="mx-auto hidden max-w-6xl grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-12 px-8 py-14 lg:grid">
        <div className="flex flex-col">
          <div className="mb-8 flex items-center justify-between">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="h-14 w-14 rounded-xl bg-white object-contain p-1.5 shadow-sm" />
            ) : (
              <span />
            )}
            <LanguageToggle />
          </div>
          <h1 className="font-[family-name:var(--font-frank-ruhl)] text-6xl font-black leading-[1.02] text-[#0E3B4A]">
            {org.name}
          </h1>
          <WaveRule className="mt-5 h-4 w-44" />
          {org.subtitle && (
            <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-[#13232B]/75">{org.subtitle}</p>
          )}
          <div className="mt-10">{panel}</div>
        </div>
        <div className="sticky top-10 self-start">
          <PhotoGallery
            images={org.gallery}
            orgName={org.name}
            frameClassName="aspect-[4/5] rounded-3xl shadow-[0_30px_60px_-30px_rgba(14,59,74,0.55)]"
          />
        </div>
      </div>
    </main>
  );
}
