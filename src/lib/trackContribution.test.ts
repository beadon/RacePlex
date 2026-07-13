import { describe, expect, it } from 'vitest';
import { buildContributions, issueUrl, trackSlug } from './trackContribution';
import { validateTrack } from '../../scripts/tracks-validate.mjs';
import type { Track } from '@/types/racing';
import type { SubmissionCourse } from './trackSubmission';

const LAYOUT = [
  { lat: 29.9999, lon: -97.0 },
  { lat: 30.0005, lon: -97.0 },
  { lat: 30.0005, lon: -96.999 },
  { lat: 29.9999, lon: -96.999 },
  { lat: 29.9999, lon: -97.0 },
];

function sub(overrides: Partial<SubmissionCourse> = {}): SubmissionCourse {
  return {
    trackName: 'Test Hill',
    trackShortName: 'TH',
    courseName: 'Main',
    type: 'new_track',
    change: 'new-track',
    courseData: {
      start_a_lat: 30.0,
      start_a_lng: -97.0001,
      start_b_lat: 30.0,
      start_b_lng: -96.9999,
    },
    layout: LAYOUT,
    contentHash: 'abc123',
    key: 'Test Hill␟Main',
    alreadySubmitted: false,
    ...overrides,
  };
}

function merged(overrides: Partial<Track> = {}): Track[] {
  return [
    {
      name: 'Test Hill',
      shortName: 'TH',
      isUserDefined: true,
      courses: [
        {
          name: 'Main',
          lengthFt: 1000,
          startFinishA: { lat: 30.0, lon: -97.0001 },
          startFinishB: { lat: 30.0, lon: -96.9999 },
          layout: LAYOUT,
          isUserDefined: true,
        },
      ],
      ...overrides,
    } as Track,
  ];
}

describe('trackSlug', () => {
  it('matches the filename the validator demands', () => {
    expect(trackSlug('Orlando Kart Center')).toBe('orlando-kart-center');
    expect(trackSlug("Rider's Hill (North)")).toBe('rider-s-hill-north');
  });
});

describe('buildContributions', () => {
  it('produces one file per track, not one per course', () => {
    const out = buildContributions(
      [sub(), sub({ courseName: 'Short', key: 'Test Hill␟Short' })],
      merged(),
      undefined,
      '2026-07-12',
    );
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe('test-hill.json');
    expect(out[0].courseNames).toEqual(['Main', 'Short']);
  });

  it('separates distinct tracks into distinct files', () => {
    const out = buildContributions(
      [sub(), sub({ trackName: 'Other Hill', trackShortName: 'OH', key: 'Other Hill␟Main' })],
      merged(),
      undefined,
      '2026-07-12',
    );
    expect(out.map((c) => c.fileName).sort()).toEqual(['other-hill.json', 'test-hill.json']);
  });

  it('carries lengthFt from the live course', () => {
    const rec = JSON.parse(buildContributions([sub()], merged(), undefined, '2026-07-12')[0].json);
    expect(rec.courses[0].lengthFt).toBe(1000);
  });

  it('includes the drawn outline', () => {
    const rec = JSON.parse(buildContributions([sub()], merged(), undefined, '2026-07-12')[0].json);
    expect(rec.courses[0].layout).toHaveLength(LAYOUT.length);
  });

  it('records credit only when given', () => {
    const anon = JSON.parse(buildContributions([sub()], merged(), '', '2026-07-12')[0].json);
    expect(anon.meta).toEqual({ addedAt: '2026-07-12' });

    const credited = JSON.parse(buildContributions([sub()], merged(), '@rider', '2026-07-12')[0].json);
    expect(credited.meta.submittedBy).toBe('@rider');
  });

  it('ends the file with a newline, as the build script writes it', () => {
    expect(buildContributions([sub()], merged(), undefined, '2026-07-12')[0].json.endsWith('}\n')).toBe(true);
  });

  // The point of the whole feature: what the app emits must be mergeable. If
  // these two ever drift, riders get PRs that CI rejects for reasons they can't
  // fix — so assert the app's output against the real validator.
  it('emits a record the repo validator accepts', () => {
    const c = buildContributions([sub()], merged(), '@rider', '2026-07-12')[0];
    expect(validateTrack(JSON.parse(c.json), c.fileName)).toEqual([]);
  });

  it('emits a valid record for a multi-course track', () => {
    const c = buildContributions(
      [sub(), sub({ courseName: 'Short', key: 'Test Hill␟Short' })],
      merged({
        courses: [
          {
            name: 'Main',
            lengthFt: 1000,
            startFinishA: { lat: 30.0, lon: -97.0001 },
            startFinishB: { lat: 30.0, lon: -96.9999 },
            layout: LAYOUT,
            isUserDefined: true,
          },
          {
            name: 'Short',
            lengthFt: 500,
            startFinishA: { lat: 30.0, lon: -97.0001 },
            startFinishB: { lat: 30.0, lon: -96.9999 },
            layout: LAYOUT,
            isUserDefined: true,
          },
        ],
      } as Partial<Track>),
      undefined,
      '2026-07-12',
    )[0];
    expect(validateTrack(JSON.parse(c.json), c.fileName)).toEqual([]);
  });
});

describe('issueUrl', () => {
  it('prefills the form with the track JSON', () => {
    const c = buildContributions([sub({ layout: undefined })], merged(), undefined, '2026-07-12')[0];
    const { url, prefilled } = issueUrl(c, 'Austin, TX');
    expect(prefilled).toBe(true);
    expect(url).toContain('template=track_submission.yml');
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('track-name')).toBe('Test Hill');
    expect(qs.get('location')).toBe('Austin, TX');
    expect(qs.get('track-json')).toBe(c.json);
  });

  // A long outline blows GitHub's URL limit; opening an empty form beats a URL
  // that 414s, provided the caller has the JSON on the clipboard.
  it('drops the body when the JSON is too big to prefill', () => {
    const huge = Array.from({ length: 2000 }, (_, i) => ({ lat: 30 + i * 1e-6, lon: -97 }));
    const c = buildContributions([sub({ layout: huge })], merged(), undefined, '2026-07-12')[0];
    const { url, prefilled } = issueUrl(c);
    expect(prefilled).toBe(false);
    expect(new URLSearchParams(url.split('?')[1]).get('track-json')).toBeNull();
    expect(url).toContain('template=track_submission.yml');
  });
});
