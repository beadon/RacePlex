import { describe, it, expect, vi } from 'vitest';
import { shareOrDownloadSession } from './shareSession';

/** Vitest runs in `node`, which has neither `navigator` nor a real DOM. */
function installFakeDom() {
  const clicked: string[] = [];
  const fakeAnchor = { href: '', download: '', click: () => clicked.push('click') };
  vi.stubGlobal('document', {
    createElement: () => fakeAnchor,
    body: { appendChild: () => {}, removeChild: () => {} },
  });
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => {},
  });
  return { fakeAnchor, clicked };
}

describe('shareOrDownloadSession', () => {
  it('shares the file with a RacePlex message when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });

    await shareOrDownloadSession('ride.rplx', new Blob(['x']));

    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0];
    expect(arg.files[0].name).toBe('ride.rplx');
    expect(arg.text).toContain('https://beadon.github.io/RacePlex/');
  });

  it('treats a cancelled share sheet as done, not a reason to fall back to download', async () => {
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    const { clicked } = installFakeDom();

    await shareOrDownloadSession('ride.rplx', new Blob(['x']));

    expect(clicked).toHaveLength(0);
  });

  it('falls back to a download when the browser cannot share files at all', async () => {
    vi.stubGlobal('navigator', {});
    const { fakeAnchor, clicked } = installFakeDom();

    await shareOrDownloadSession('ride.rplx', new Blob(['x']));

    expect(clicked).toEqual(['click']);
    expect(fakeAnchor.download).toBe('ride.rplx');
  });

  it('falls back to a download when canShare rejects this data', async () => {
    const share = vi.fn();
    vi.stubGlobal('navigator', { share, canShare: () => false });
    const { clicked } = installFakeDom();

    await shareOrDownloadSession('ride.rplx', new Blob(['x']));

    expect(share).not.toHaveBeenCalled();
    expect(clicked).toEqual(['click']);
  });

  it('falls back to a download when share() fails for a reason other than cancellation', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('navigator', { share, canShare: () => true });
    const { clicked } = installFakeDom();

    await shareOrDownloadSession('ride.rplx', new Blob(['x']));

    expect(clicked).toEqual(['click']);
  });
});
