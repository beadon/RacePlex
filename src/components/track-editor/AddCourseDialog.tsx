import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { GpsPoint } from './VisualEditor';
import type { SelectedLine } from '@/hooks/useTrackEditorForm';
import type { CourseSector, SectorLine, Lap, GpsSample } from '@/types/racing';

// Lazy — CourseSectorEditor pulls in the Leaflet drawing map + the dnd-kit
// sector list, neither of which belongs in the eager landing bundle.
const CourseSectorEditor = lazy(() =>
  import('./CourseSectorEditor').then((m) => ({ default: m.CourseSectorEditor })),
);

interface AddCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseName: string;
  onCourseNameChange: (value: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  startFinishA: GpsPoint | null;
  startFinishB: GpsPoint | null;
  sectors: CourseSector[];
  selectedLine: SelectedLine;
  onSelectLine: (id: SelectedLine) => void;
  onStartFinishChange: (a: GpsPoint, b: GpsPoint) => void;
  onSectorLineChange: (index: number, line: SectorLine) => void;
  onAddSector: (insertIndex?: number, center?: GpsPoint) => void;
  onRemoveSector: (index: number) => void;
  onToggleMajor: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  initialCenter?: GpsPoint | null;
  /** Drawing support — draw the outline manually or generate it from a lap. */
  layoutPoints?: Array<{ lat: number; lon: number }>;
  onLayoutChange?: (points: Array<{ lat: number; lon: number }>) => void;
  laps?: Lap[];
  samples?: GpsSample[];
}

export function AddCourseDialog({
  open, onOpenChange,
  courseName, onCourseNameChange, canSubmit,
  onSubmit, onCancel,
  startFinishA, startFinishB, sectors, selectedLine, onSelectLine,
  onStartFinishChange, onSectorLineChange,
  onAddSector, onRemoveSector, onToggleMajor, onReorder,
  initialCenter,
  layoutPoints, onLayoutChange, laps, samples,
}: AddCourseDialogProps) {
  const { t } = useTranslation('tracks');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><span className="sr-only">{t('addCourse.srTrigger')}</span></DialogTrigger>
      {/* Full-screen. Drawing a course means reading a timing line against the
          corner it sits in, and a 2xl box with a fixed 384px map showed neither
          properly. The map is the flexing row; the name field and the buttons stay
          pinned at the bottom so they never scroll out of reach. */}
      <DialogContent className="max-w-none w-screen h-[100dvh] sm:h-screen rounded-none border-0 flex flex-col gap-4 p-4 sm:p-6 safe-area-modal">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('addCourse.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <Suspense fallback={null}>
          <CourseSectorEditor
            fillHeight
            startFinishA={startFinishA}
            startFinishB={startFinishB}
            sectors={sectors}
            selectedLine={selectedLine}
            onSelectLine={onSelectLine}
            onStartFinishChange={onStartFinishChange}
            onSectorLineChange={onSectorLineChange}
            onAddSector={onAddSector}
            onRemoveSector={onRemoveSector}
            onToggleMajor={onToggleMajor}
            onReorder={onReorder}
            isNewTrack
            initialCenter={initialCenter}
            showDrawTool
            layoutPoints={layoutPoints}
            onLayoutChange={onLayoutChange}
            laps={laps}
            samples={samples}
          />
          </Suspense>
          {/* Pinned below the map: on a phone these would otherwise sit under the
              fold of a full-height editor. */}
          <div className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="addCourseName">{t('addCourse.courseName')}</Label>
              <Input id="addCourseName" value={courseName} onChange={(e) => onCourseNameChange(e.target.value)} onKeyDownCapture={(e) => e.stopPropagation()} placeholder={t('addCourse.courseNamePlaceholder')} className="font-mono" />
            </div>
            <div className="flex gap-2">
              <Button onClick={onSubmit} className="flex-1 sm:flex-none" disabled={!canSubmit}>
                <Check className="w-4 h-4 mr-2" />
                {t('addCourse.create')}
              </Button>
              <Button variant="outline" onClick={onCancel}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
