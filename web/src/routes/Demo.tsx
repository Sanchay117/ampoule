// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChainPanel } from '../components/ChainPanel';
import { CHAPTERS, chapterIndexOf, chapterPath, playUpTo } from '../demo/chapters';
import { useStory } from '../demo/useStory';
import { utcTime } from '../lib/format';

export default function Demo() {
  const story = useStory();
  const index = chapterIndexOf(useParams().chapter);
  const chapter = CHAPTERS[index]!;
  const [selected, setSelected] = useState<number>();
  const view = story.world.view();
  const log = story.world.log;

  // A new call takes the chain panel back to "latest".
  useEffect(() => {
    setSelected(undefined);
  }, [log.length]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // On a phone the chapter list is a horizontal strip; keep the open chapter in view.
    document.querySelector('.chapter-link.current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    setSelected(chapter.focus?.(story.s)?.id);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlocked = (i: number) => i === 0 || CHAPTERS.slice(0, i).every((c) => c.done(story.s));
  const Stage = chapter.Stage;

  return (
    <div className="demo">
      <nav className="chapters" aria-label="Chapters">
        <div className="kicker">Guided demo</div>
        <p className="small muted" style={{ marginTop: 6 }}>
          The real compiled contract, running in this tab. No wallet, no sign-up.
        </p>
        <ol>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <Link
                to={chapterPath(i)}
                className={`chapter-link${i === index ? ' current' : ''}${c.done(story.s) ? ' done' : ''}${unlocked(i) ? '' : ' locked'}`}
                data-testid={`chapter-${c.id}`}
              >
                <span className="no">{c.done(story.s) ? '✓' : i + 1}</span>
                <span>{c.title}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="clock">
          Chain clock
          <b data-testid="clock">{utcTime(story.world.now)}</b>
        </div>
        <div className="side-actions">
          {index < CHAPTERS.length - 1 && !CHAPTERS.slice(0, CHAPTERS.length - 1).every((c) => c.done(story.s)) && (
            <button
              className="btn ghost sm"
              disabled={!!story.busy}
              onClick={() => void playUpTo(story, CHAPTERS.length - 1)}
              data-testid="play-all"
            >
              Play the whole story
            </button>
          )}
          <button className="btn ghost sm" disabled={!!story.busy} onClick={() => story.reset()}>
            Start over
          </button>
        </div>
      </nav>

      <main className="stage">
        <header className="stage-head">
          <div className="kicker">{chapter.kicker}</div>
          <h2>{chapter.title}</h2>
          <p className="story">{chapter.story}</p>
          <div className="learn">
            <div className="pub">
              <b>Public</b>
              {chapter.pub}
            </div>
            <div className="priv">
              <b>Stays private</b>
              {chapter.priv}
            </div>
          </div>
        </header>
        {story.error && (
          <div className="no-box" style={{ marginTop: 18 }}>
            <b>Something went wrong</b>
            {story.error}
          </div>
        )}
        <Stage />
      </main>

      <ChainPanel log={log} view={view} selected={selected} onSelect={setSelected} />
    </div>
  );
}
