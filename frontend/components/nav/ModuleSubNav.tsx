'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MODULES } from '@/lib/routes';
import { usePermissions } from '@/hooks/usePermissions';
import { useLostDamagedPending } from '@/hooks/useLostDamagedPending';

const COMING_SOON_PATHS = new Set<string>([]);

const FEES_SOON_BADGE_PATHS = new Set<string>([]);

/** Finds the module that "owns" the given pathname */
function findOwnerModule(pathname: string) {
  let match = MODULES.find(m => m.path === pathname);
  if (match) return match;
  match = MODULES.find(m => m.sub.some(s => s.path === pathname));
  if (match) return match;
  const byLength = [...MODULES]
    .filter(m => pathname.startsWith(m.path) && m.path !== '/')
    .sort((a, b) => b.path.length - a.path.length);
  return byLength[0] ?? null;
}

export function ModuleSubNav() {
  const pathname = usePathname();
  const mod = findOwnerModule(pathname);
  const { can, canAnyPrefix } = usePermissions();
  // Pending lost and damaged reports, shown as a count on the Library nav item. No request outside the Library module.
  const lostPending = useLostDamagedPending(mod?.id === 'library' && can('library.lost_damaged.view'));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll, mod]);

  // Scroll active tab into view on route change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  if (!mod || mod.sub.length === 0) return null;

  // Standard light bar — same for every module (Examination's Command
  // Center now matches this palette instead of the other way around).
  const barBg = '#fff';
  const barBorder = 'var(--bd)';
  const textMuted = 'var(--ink-2)';
  const textStrong = 'var(--ink-1)';
  const chipBg = mod.bg;
  const chipIcon = mod.ic;

  // Find the best-matching active tab (longest path match wins, preventing parent paths from being
  // active on child routes, e.g. /roles being active on /roles/login-permission)
  const activeTab = mod.sub.reduce<typeof mod.sub[0] | null>((best, s) => {
    const isExact = pathname === s.path;
    const isPrefix = pathname.startsWith(s.path + '/');
    if (!isExact && !isPrefix) return best;
    if (!best) return s;
    return s.path.length > best.path.length ? s : best;
  }, null);

  const arrowBtn = (dir: 'left' | 'right', enabled: boolean) => (
    <button
      onClick={() => scroll(dir)}
      disabled={!enabled}
      style={{
        flexShrink: 0, width: 28, height: 46, border: 'none', cursor: enabled ? 'pointer' : 'default',
        background: enabled
          ? `linear-gradient(to ${dir === 'left' ? 'right' : 'left'}, ${barBg} 60%, transparent)`
          : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: enabled ? 1 : 0.25, transition: 'opacity 0.15s',
        position: 'relative', zIndex: 2,
        padding: 0,
      }}
    >
      {dir === 'left'
        ? <ChevronLeft size={15} color={textMuted} strokeWidth={2} />
        : <ChevronRight size={15} color={textMuted} strokeWidth={2} />
      }
    </button>
  );

  return (
    <div style={{ background: barBg, borderBottom: `1px solid ${barBorder}`, position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', minHeight: 46,
        padding: mod.cleanTabs ? '0 18px' : '0 18px 0 8px', gap: 0,
        overflow: 'visible',
      }}>
        {/* Module label — hidden when cleanTabs is set (e.g. Fees module) */}
        {!mod.cleanTabs && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            paddingRight: 12, marginRight: 7,
            borderRight: `1px solid ${barBorder}`,
            flexShrink: 0,
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6,
              background: chipBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <mod.icon size={11} color={chipIcon} strokeWidth={1.8} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: textMuted, whiteSpace: 'nowrap' }}>
              {mod.name}
            </span>
          </div>
        )}

        {/* Left arrow — hidden for cleanTabs modules */}
        {!mod.cleanTabs && arrowBtn('left', canScrollLeft)}

        {/* Scrollable tabs — left-aligned */}
        <div
          ref={scrollRef}
          style={{ display: 'flex', overflowX: 'auto', overflowY: 'visible', scrollbarWidth: 'none', gap: 0, flex: 1 }}
        >
          {mod.sub.map(s => {
            const isActive = s === activeTab;
            const SubIcon = s.icon ?? mod.icon;

            // Permission check: specific code wins; fall back to module prefix
            const allowed = s.permission
              ? can(s.permission)
              : mod.permission
                ? canAnyPrefix(mod.permission)
                : true;

            // Hidden — user has no permission
            if (!allowed) return null;

            const subComingSoon = COMING_SOON_PATHS.has(s.path);
            const showSoonBadge = subComingSoon || FEES_SOON_BADGE_PATHS.has(s.path);

            return (
              <Link
                key={s.path}
                href={s.path}
                data-active={isActive ? 'true' : 'false'}
                onClick={subComingSoon ? (e) => e.preventDefault() : undefined}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 4,
                  height: 46, padding: '1px 14px 0',
                  fontSize: 13, fontWeight: 600,
                  lineHeight: 1.25,
                  color: isActive ? 'var(--pu)' : textMuted,
                  textDecoration: 'none', whiteSpace: 'nowrap',
                  transition: 'color 0.12s',
                  borderBottom: isActive ? '2px solid var(--pu)' : '2px solid transparent',
                  flexShrink: 0,
                  cursor: subComingSoon ? 'default' : 'pointer',
                }}
                onMouseEnter={e => {
                  if (!isActive && !subComingSoon) (e.currentTarget as HTMLAnchorElement).style.color = textStrong;
                }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = textMuted;
                }}
              >
                {!mod.cleanTabs && <SubIcon size={12} strokeWidth={1.8} />}
                {s.label}
                {s.path === '/library/lost-damaged' && lostPending > 0 && (
                  <span
                    aria-label={`${lostPending} pending`}
                    style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--bg-1)', background: 'var(--danger)',
                      borderRadius: 999, padding: '1px 6px', marginLeft: 4, flexShrink: 0,
                    }}
                  >{lostPending > 99 ? '99+' : lostPending}</span>
                )}
                {showSoonBadge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                    color: '#fff', background: 'var(--pu, #6D28D9)',
                    borderRadius: 999, padding: '1px 6px', marginLeft: 4, flexShrink: 0,
                  }}>Soon</span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Right arrow */}
        {arrowBtn('right', canScrollRight)}
      </div>
    </div>
  );
}
