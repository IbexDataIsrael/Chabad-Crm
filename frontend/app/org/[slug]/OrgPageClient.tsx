"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/components/LanguageToggle";
import { PhotoGallery } from "@/components/public/PhotoGallery";
import { ActivistRegisterForm, OrgSignInForm } from "@/components/public/PublicAuthForms";
import { WaveRule } from "@/components/public/WaveRule";
import { apiFetch, ApiError, hasLoggedInBefore } from "@/lib/api";
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
  const { t, lang } = useLocalization();
  const { user, loading: authLoading } = useAuth();
  const [org, setOrg] = useState<PublicOrg | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<Mode>("join");

  useEffect(() => {
    apiFetch<PublicOrg>(`/api/public/orgs/${encodeURIComponent(slug)}`)
      .then((o) => {
        setOrg(o);
        // Returning users (anyone who ever logged in on this device) land
        // on sign-in — register is for first-timers only.
        if (!o.self_registration_enabled || hasLoggedInBefore()) setMode("signin");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setMissing(true);
      });
  }, [slug]);

  // The browser tab shows this org's name + logo (TitleManager owns both).
  // fixes85: English title/subtitle when the page is in English (falls back
  // to the Hebrew ones when blank).
  const orgTitle = org ? (lang === "en" && org.name_en ? org.name_en : org.name) : "";
  const orgSubtitle = org ? (lang === "en" && org.subtitle_en ? org.subtitle_en : org.subtitle) : null;

  useEffect(() => {
    setPageOrg(org ? { name: orgTitle, logoUrl: org.logo_url } : null);
    return () => setPageOrg(null);
  }, [org, orgTitle]);

  if (missing) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="glass-card max-w-sm space-y-3 p-8 text-center">
          <WaveRule className="mx-auto h-4 w-28" color="hsl(var(--primary))" />
          <p className="text-lg font-medium text-foreground">
            {t("public.org_not_found", "לא מצאנו דף ארגון בכתובת הזו.")}
          </p>
          <Link href="/" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
            {t("public.go_to_login", "למסך ההתחברות")}
          </Link>
        </div>
      </main>
    );
  }

  if (!org) {
    return <main className="min-h-[70vh]" aria-busy="true" />;
  }

  const signedInHere = !authLoading && user && user.organization_id === org.id;
  const canJoin = org.self_registration_enabled;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
      active ? "bg-white/10 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;

  const panel = (
    <section
      aria-label={t("public.access_panel", "הצטרפות והתחברות")}
      className="glass-card p-5 sm:p-7"
    >
      {signedInHere ? (
        <div className="space-y-4 text-center">
          <p className="text-[15px] text-foreground">
            {t("public.signed_in_as", "את/ה מחובר/ת כ־{name}.").replace(
              "{name}",
              user.display_name || user.full_name,
            )}
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full rounded-lg bg-gradient-to-b from-primary/95 to-primary px-4 py-3 font-semibold text-primary-foreground shadow-glow transition-all hover:from-primary hover:to-primary/85"
          >
            {t("public.open_system", "כניסה למערכת")}
          </button>
        </div>
      ) : (
        <>
          {canJoin && (
            <div className="mb-6 flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1" role="tablist">
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
              <p className="mb-5 text-[15px] leading-relaxed text-muted-foreground">
                {t(
                  "public.join_intro",
                  "ממלאים את הפרטים ומתחילים מיד — בלי המתנה לאישור. המשימות שתקבלו יופיעו באזור האישי שלכם.",
                )}
              </p>
              <ActivistRegisterForm
                orgSlug={org.slug}
                organizationId={org.id}
                onRegistered={() => router.push("/dashboard")}
                onSignedIn={() => router.push("/dashboard")}
              />
            </>
          ) : (
            <OrgSignInForm organizationId={org.id} onSignedIn={() => router.push("/dashboard")} />
          )}
        </>
      )}
    </section>
  );

  return (
    <main className="min-h-screen">
      {/* Mobile: the gallery is the hero, the name sits on it, the panel
          rides up over its bottom edge. Desktop: name + panel on the
          reading-start side, the gallery large beside them. */}
      <div className="lg:hidden">
        <div className="relative">
          <PhotoGallery
            images={org.gallery}
            orgName={orgTitle}
            frameClassName="h-[58vh] min-h-[340px]"
            showThumbnails={false}
          />
          {/* Name + subtitle over the photo; pointer-events off so swipes and
              the gallery's own buttons still reach the photo underneath. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[58vh] min-h-[340px] flex-col justify-end bg-gradient-to-t from-background via-background/45 to-transparent px-5 pb-14">
            {org.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="absolute start-4 top-4 h-11 w-11 rounded-lg bg-white/90 object-contain p-1" />
            )}
            <h1 className="font-display text-[2.6rem] font-bold leading-[1.05] text-white">
              {orgTitle}
            </h1>
            <WaveRule className="mt-3 h-3.5 w-32" />
            {orgSubtitle && (
              <p className="mt-3 max-w-[36ch] text-[15px] leading-relaxed text-white/85">{orgSubtitle}</p>
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
          <h1 className="font-display text-6xl font-bold leading-[1.02] text-foreground">
            {orgTitle}
          </h1>
          <WaveRule className="mt-5 h-4 w-44" />
          {orgSubtitle && (
            <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-muted-foreground">{orgSubtitle}</p>
          )}
          <div className="mt-10">{panel}</div>
        </div>
        <div className="sticky top-10 self-start">
          <PhotoGallery
            images={org.gallery}
            orgName={orgTitle}
            frameClassName="aspect-[4/5] rounded-3xl border border-white/10 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)]"
          />
        </div>
      </div>

      {org.public_footer_html && (
        <section aria-label={t("public.footer_section", "מידע נוסף")} className="mx-auto max-w-6xl px-4 pb-14 sm:px-8">
          <div className="glass-card p-6 sm:p-8">
            <div
              className="prose max-w-none leading-relaxed text-foreground/90 [&_img]:max-w-full [&_img]:rounded-lg"
              dangerouslySetInnerHTML={{ __html: org.public_footer_html }}
            />
          </div>
        </section>
      )}
    </main>
  );
}
