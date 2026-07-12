import { useState, useEffect, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { ArrowRight, ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Check, Copy, ExternalLink, GitPullRequest } from 'lucide-react';
import { loadTracks, loadDefaultTracks } from '@/lib/trackStorage';
import { buildSubmissionPlan, type SubmissionPlan, type SubmissionCourse } from '@/lib/trackSubmission';
import { buildContributions, issueUrl, type TrackContribution } from '@/lib/trackContribution';
import { loadSubmittedRecords, markCoursesSubmitted } from '@/lib/submittedTracksStorage';
import type { Track } from '@/types/racing';

interface SubmitTrackDialogProps {
  trigger: React.ReactNode;
  /** Notified after a contribution is handed off (e.g. to refresh a count badge). */
  onSubmitted?: () => void;
}

type Step = 'confirm' | 'review' | 'contribute';

/** A new track can't be contributed without the short name the record requires. */
function isBlocked(course: SubmissionCourse): boolean {
  return course.type === 'new_track' && !course.trackShortName?.trim();
}

const changeLabel = (change: SubmissionCourse['change'], t: TFunction<'tracks'>): string => {
  switch (change) {
    case 'new-track': return t('submit.changeNewTrack');
    case 'new-course': return t('submit.changeNewCourse');
    default: return t('submit.changeModified');
  }
};

const CHANGE_STYLE: Record<SubmissionCourse['change'], string> = {
  'new-track': 'bg-primary/20 text-primary',
  'new-course': 'bg-primary/20 text-primary',
  modified: 'bg-amber-500/20 text-amber-400',
};

export function SubmitTrackDialog({ trigger, onSubmitted }: SubmitTrackDialogProps) {
  const { t } = useTranslation('tracks');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('confirm');
  const [plan, setPlan] = useState<SubmissionPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tracks, setTracks] = useState<Track[]>([]);
  const [credit, setCredit] = useState('');
  const [location, setLocation] = useState('');
  const [contributions, setContributions] = useState<TrackContribution[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  // Build the plan from everything the user currently has locally.
  const buildPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const [merged, defaults] = await Promise.all([loadTracks(), loadDefaultTracks()]);
      setTracks(merged);
      const p = buildSubmissionPlan(merged, defaults, loadSubmittedRecords());
      setPlan(p);
      // Default-select everything still pending and contributable.
      const next = new Set<string>();
      for (const g of p.groups) {
        for (const c of g.courses) {
          if (!c.alreadySubmitted && !isBlocked(c)) next.add(c.key);
        }
      }
      setSelected(next);
    } catch (e) {
      toast({ title: t('submit.toastCouldNotRead'), description: (e as Error).message, variant: 'destructive' });
    }
    setPlanLoading(false);
  }, [t]);

  // Reset + (re)build the plan each time the dialog opens.
  useEffect(() => {
    if (open) {
      setStep('confirm');
      setContributions([]);
      setCopied(null);
      buildPlan();
    }
  }, [open, buildPlan]);

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectedCourses: SubmissionCourse[] =
    plan?.groups.flatMap(g => g.courses).filter(c => selected.has(c.key)) ?? [];

  const handlePrepare = () => {
    if (selectedCourses.length === 0) {
      toast({ title: t('submit.toastNothingSelected'), variant: 'destructive' });
      return;
    }
    setContributions(buildContributions(selectedCourses, tracks, credit));
    setStep('contribute');
  };

  const copy = async (c: TrackContribution) => {
    try {
      await navigator.clipboard.writeText(c.json);
      setCopied(c.fileName);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: t('submit.toastCopyFailed'), variant: 'destructive' });
    }
  };

  /**
   * Opening the issue is the hand-off. Copy the JSON first regardless: when the
   * outline is too big to ride in the URL, the clipboard is the only way it
   * reaches the form.
   */
  const openIssue = async (c: TrackContribution) => {
    const { url, prefilled } = issueUrl(c, location);
    if (!prefilled) {
      await copy(c);
      toast({ title: t('submit.toastPasteNeeded'), description: t('submit.toastPasteNeededDesc') });
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    // The rider still has to submit the form, but from our side it's handed off:
    // remembering it keeps the plan from re-listing it every time they reopen.
    markCoursesSubmitted(selectedCourses, `pr-${Date.now()}`);
    onSubmitted?.();
  };

  const pendingCount = plan?.pendingCount ?? 0;
  const hasAnything = (plan?.groups.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitPullRequest className="w-5 h-5 text-primary" />
                {t('submit.confirmTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('submit.confirmDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm text-muted-foreground">
                <p className="text-foreground font-medium">{t('submit.whatHappens')}</p>
                <ul className="list-disc list-inside space-y-1.5">
                  <li>{t('submit.li1')}</li>
                  <li><Trans ns="tracks" i18nKey="submit.li2" components={{ b: <strong className="text-foreground" /> }} /></li>
                  <li>{t('submit.li3')}</li>
                  <li>{t('submit.li4')}</li>
                </ul>
              </div>
              <Button onClick={() => setStep('review')} className="w-full" disabled={planLoading}>
                {planLoading
                  ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('submit.checking')}</>)
                  : (<><ArrowRight className="w-4 h-4 mr-2" /> {t('submit.reviewBtn')}{pendingCount > 0 ? ` (${pendingCount})` : ''}</>)}
              </Button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('submit.reviewTitle')}</DialogTitle>
              <DialogDescription>
                {t('submit.reviewDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {!hasAnything ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  {t('submit.nothingNew')}
                </div>
              ) : (
                <div className="space-y-3">
                  {plan!.groups.map(group => (
                    <div key={group.trackName} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{group.trackName}</span>
                        {group.shortName && <span className="text-xs text-muted-foreground">({group.shortName})</span>}
                        <span className={`text-xs px-2 py-0.5 rounded ${group.trackStatus === 'new' ? 'bg-primary/20 text-primary' : 'bg-amber-500/20 text-amber-400'}`}>
                          {group.trackStatus === 'new' ? t('submit.statusNew') : t('submit.statusEdited')}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {group.courses.map(course => {
                          const blocked = isBlocked(course);
                          const checked = selected.has(course.key);
                          return (
                            <button
                              key={course.key}
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              disabled={blocked}
                              onClick={() => toggle(course.key)}
                              className={`w-full flex items-center gap-2 text-sm text-left ${blocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
                                {checked && <Check className="w-3 h-3" />}
                              </span>
                              <span className="flex-1 flex items-center gap-2 flex-wrap">
                                <span className="text-foreground">{course.courseName}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${CHANGE_STYLE[course.change]}`}>
                                  {changeLabel(course.change, t)}
                                </span>
                                {course.layout && course.layout.length >= 2 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                                    {t('submit.drawingBadge')}
                                  </span>
                                )}
                                {course.alreadySubmitted && (
                                  <span className="text-xs text-muted-foreground">{t('submit.alreadySubmitted')}</span>
                                )}
                                {blocked && (
                                  <span className="flex items-center gap-1 text-xs text-amber-400">
                                    <AlertTriangle className="w-3 h-3" /> {t('submit.needsShortName')}
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {hasAnything && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor="track-location" className="text-xs text-muted-foreground">
                      {t('submit.locationLabel')}
                    </label>
                    <Input
                      id="track-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder={t('submit.locationPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="track-credit" className="text-xs text-muted-foreground">
                      {t('submit.creditLabel')}
                    </label>
                    <Input
                      id="track-credit"
                      value={credit}
                      onChange={(e) => setCredit(e.target.value)}
                      placeholder={t('submit.creditPlaceholder')}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('confirm')} className="flex-shrink-0">
                  <ArrowLeft className="w-4 h-4 mr-1" /> {t('submit.back')}
                </Button>
                <Button onClick={handlePrepare} disabled={selectedCourses.length === 0} className="flex-1">
                  <ArrowRight className="w-4 h-4 mr-2" />
                  {t('submit.prepareBtn', { count: selectedCourses.length })}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'contribute' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitPullRequest className="w-5 h-5 text-primary" />
                {t('submit.contributeTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('submit.contributeDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {contributions.map((c) => (
                <div key={c.fileName} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{c.trackName}</span>
                    <code className="text-xs text-muted-foreground">tracks/{c.fileName}</code>
                  </div>
                  <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                    {c.json}
                  </pre>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copy(c)} className="flex-shrink-0">
                      {copied === c.fileName
                        ? (<><Check className="w-4 h-4 mr-1" /> {t('submit.copied')}</>)
                        : (<><Copy className="w-4 h-4 mr-1" /> {t('submit.copyJson')}</>)}
                    </Button>
                    <Button size="sm" onClick={() => openIssue(c)} className="flex-1">
                      <ExternalLink className="w-4 h-4 mr-1" /> {t('submit.openIssue')}
                    </Button>
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted-foreground">
                <Trans
                  ns="tracks"
                  i18nKey="submit.prNote"
                  components={{ c: <code className="text-foreground" /> }}
                />
              </p>

              <Button variant="outline" onClick={() => setStep('review')} className="w-full">
                <ArrowLeft className="w-4 h-4 mr-1" /> {t('submit.back')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
