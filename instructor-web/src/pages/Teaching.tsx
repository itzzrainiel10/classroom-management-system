import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Icon } from '../components/icons';
import { CardHead, Confirm, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Success, Tile } from '../components/ui';
import { useData } from '../hooks/useData';
import { downloadCsv, fmtDateTime, fmtNum } from '../services/format';
import {
  QUESTION_TYPES,
  alternatives,
  createClass,
  deletePost,
  deleteQuiz,
  fetchAttempt,
  fetchMyClasses,
  fetchPosts,
  fetchQuizForEdit,
  fetchQuizzes,
  fetchRoster,
  gradeAttempt,
  postAnnouncement,
  postAssignment,
  ACCEPT_FILES,
  MAX_FILE_MB,
  attachmentUrl,
  fmtSize,
  type Attachment,
  saveQuiz,
  typeLabel,
  type Attempt,
  type ClassRef,
  type KeyedQuestion,
  type QuestionDraft,
  type QuestionType,
  type QuizRow,
} from '../services/teaching';

const classLabel = (c: ClassRef | null | undefined) => (c ? `${c.code} · ${c.title} (${c.section})` : '—');
const pct = (a: Attempt) => (a.total ? Math.round((a.score / a.total) * 100) : 0);
/** ISO → value for <input type="datetime-local"> in local time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/* ---------- Shared: class picker with "new class" ---------- */

function ClassSelect({ classes, value, onChange, onCreated }: { classes: ClassRef[]; value: string; onChange: (id: string) => void; onCreated: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Field label="Class">
        <div className="row">
          <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            {!classes.length ? <option value="">No classes yet</option> : null}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> New class
          </button>
        </div>
      </Field>
      {adding ? (
        <NewClassModal
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await onCreated();
          }}
        />
      ) : null}
    </>
  );
}

export function NewClassModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [v, setV] = useState({ code: '', title: '', section: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!v.code.trim() || !v.title.trim() || !v.section.trim()) return setErr('Enter the subject code, title and section.');
    setBusy(true);
    setErr(null);
    try {
      await createClass({ code: v.code.trim(), title: v.title.trim(), section: v.section.trim(), description: v.description.trim() });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New class"
      sub="Students join by being enrolled in this class (by you in the mobile app, or by the administrator)."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Create class'}
          </button>
        </>
      }>
      <div className="form-grid">
        <Field label="Subject code">
          <input className="input" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="ITEC 116" autoFocus />
        </Field>
        <Field label="Section">
          <input className="input" value={v.section} onChange={(e) => setV({ ...v, section: e.target.value })} placeholder="BSIT 3-1" />
        </Field>
      </div>
      <Field label="Title">
        <input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Web Development" />
      </Field>
      {err ? <ErrorNote message={err} /> : null}
    </Modal>
  );
}

/* ---------- Quizzes & exams list ---------- */

export function InstructorQuizzes() {
  const { data, error, refresh } = useData(fetchQuizzes);
  const [del, setDel] = useState<QuizRow | null>(null);
  return (
    <>
      <PageHeader
        title="Quizzes & Exams"
        subtitle="Create assessments for your classes. Published ones appear right away to enrolled students in the mobile app."
        actions={
          <Link to="/quizzes/new" className="btn btn-primary">
            <Icon name="plus" size={16} /> Create quiz / exam
          </Link>
        }
      />
      {error ? <ErrorNote message={error} /> : null}
      <div className="card">
        {!data ? (
          <Loading />
        ) : data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Class</th>
                  <th className="num">Questions</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th className="num">Submitted</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <b>{q.title}</b> <span className="badge gray">{q.kind === 'exam' ? 'Exam' : 'Quiz'}</span>
                    </td>
                    <td>{classLabel(q.class)}</td>
                    <td className="num">{q.questions}</td>
                    <td>{q.status === 'published' ? <span className="badge green">Published</span> : <span className="badge gold">Draft</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{q.due_at ? fmtDateTime(q.due_at) : 'No due date'}</td>
                    <td className="num">
                      {q.attempts.length}/{q.enrolled}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <Link to={`/results/${q.id}`} className="btn btn-secondary btn-sm">
                        Results
                      </Link>{' '}
                      <Link to={`/quizzes/${q.id}`} className="btn btn-secondary btn-sm">
                        Edit
                      </Link>{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => setDel(q)} aria-label={`Delete ${q.title}`}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="clipboard" title="No quizzes or exams yet" body="Create one for any of your classes.">
            <Link to="/quizzes/new" className="btn btn-primary">
              Create quiz / exam
            </Link>
          </Empty>
        )}
      </div>
      {del ? (
        <Confirm
          title={`Delete “${del.title}”?`}
          body={del.attempts.length ? `${del.attempts.length} student answer(s) and scores will be deleted too. This can’t be undone.` : 'This can’t be undone.'}
          confirmLabel="Delete"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteQuiz(del.id);
            setDel(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- Quiz / exam editor ---------- */

type EditQ = { type: QuestionType; prompt: string; points: number; choices: string[]; correct_index: number; truth: boolean; correction: string; accepted: string; items: string[]; guide: string };
const blankQ = (type: QuestionType = 'multiple_choice'): EditQ => ({ type, prompt: '', points: 1, choices: ['', '', '', ''], correct_index: 0, truth: true, correction: '', accepted: '', items: ['', '', ''], guide: '' });

function fromKeyed(q: KeyedQuestion): EditQ {
  const a = q.answer ?? {};
  return {
    ...blankQ(q.type),
    prompt: q.prompt,
    points: q.points || 1,
    choices: q.type === 'multiple_choice' ? q.choices : ['', '', '', ''],
    correct_index: q.correct_index ?? 0,
    truth: a.value ?? true,
    correction: q.type === 'modified_true_false' ? (a.accepted ?? []).join(' / ') : '',
    accepted: q.type === 'identification' ? (a.accepted ?? []).join(' / ') : '',
    items: q.type === 'enumeration' ? (a.items ?? []).map((alts) => alts.join(' / ')) : ['', '', ''],
    guide: a.guide ?? '',
  };
}

/** Editor state → payload for save_quiz, or an error message. */
function toDraft(q: EditQ, n: number): QuestionDraft | string {
  if (!q.prompt.trim()) return `Question ${n}: write the question.`;
  const base = { type: q.type, prompt: q.prompt.trim(), choices: [] as string[], points: Math.max(1, Math.min(100, q.points || 1)), correct_index: 0, answer: {} };
  switch (q.type) {
    case 'multiple_choice': {
      const filled = q.choices.map((c) => c.trim());
      const choices = filled.filter(Boolean);
      if (choices.length < 2) return `Question ${n}: add at least two choices.`;
      if (!filled[q.correct_index]) return `Question ${n}: mark which choice is correct.`;
      return { ...base, choices, correct_index: filled.slice(0, q.correct_index).filter(Boolean).length };
    }
    case 'true_false':
      return { ...base, answer: { value: q.truth } };
    case 'modified_true_false':
      if (!q.truth && !alternatives(q.correction).length) return `Question ${n}: give the word that makes the statement true.`;
      return { ...base, answer: { value: q.truth, accepted: q.truth ? [] : alternatives(q.correction) } };
    case 'identification':
      if (!alternatives(q.accepted).length) return `Question ${n}: give the correct answer.`;
      return { ...base, answer: { accepted: alternatives(q.accepted) } };
    case 'enumeration': {
      const items = q.items.map(alternatives).filter((x) => x.length);
      if (!items.length) return `Question ${n}: list the expected items.`;
      return { ...base, points: items.length, answer: { items } };
    }
    case 'essay':
      return { ...base, answer: { guide: q.guide.trim() } };
  }
}

export function InstructorQuizEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const classes = useData(fetchMyClasses);
  const existing = useData(() => (isNew ? Promise.resolve(null) : fetchQuizForEdit(id!)), [id]);
  const [quizId] = useState(() => (isNew ? crypto.randomUUID() : id!));
  const [meta, setMeta] = useState({ kind: 'quiz' as 'quiz' | 'exam', class_id: '', title: '', description: '', due: '', time_limit_minutes: 30, passing_score: 70 });
  const [questions, setQuestions] = useState<EditQ[]>([blankQ()]);
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (isNew && classes.data?.length && !meta.class_id) setMeta((m) => ({ ...m, class_id: classes.data![0].id }));
  }, [isNew, classes.data, meta.class_id]);
  useEffect(() => {
    const e = existing.data;
    if (!e?.quiz || loaded) return;
    setMeta({
      kind: e.quiz.kind ?? 'quiz',
      class_id: e.quiz.class_id,
      title: e.quiz.title,
      description: e.quiz.description,
      due: toLocalInput(e.quiz.due_at),
      time_limit_minutes: e.quiz.time_limit_minutes,
      passing_score: e.quiz.passing_score,
    });
    setQuestions(e.questions.length ? e.questions.map(fromKeyed) : [blankQ()]);
    setLoaded(true);
  }, [existing.data, loaded]);

  if (existing.error) return <ErrorNote message={existing.error} />;
  if (!isNew && existing.data && !existing.data.quiz) return <Empty icon="clipboard" title="Quiz not found" body="It may have been deleted." />;
  if (!loaded || !classes.data) return <Loading />;
  const locked = !!existing.data?.answered;
  const totalPoints = questions.reduce((n, q) => n + (q.type === 'enumeration' ? q.items.filter((x) => x.trim()).length : q.points || 1), 0);
  const upd = (i: number, p: Partial<EditQ>) => setQuestions(questions.map((q, qi) => (qi === i ? { ...q, ...p } : q)));

  const save = async (status: 'draft' | 'published') => {
    if (!meta.class_id) return setErr('Choose a class (or create one).');
    if (!meta.title.trim()) return setErr('Give the quiz a title.');
    if (meta.time_limit_minutes < 1) return setErr('Time limit must be at least 1 minute.');
    if (meta.passing_score < 0 || meta.passing_score > 100) return setErr('Passing score must be between 0 and 100%.');
    const drafts: QuestionDraft[] = [];
    if (!locked) {
      if (!questions.length) return setErr('Add at least one question.');
      for (const [i, q] of questions.entries()) {
        const d = toDraft(q, i + 1);
        if (typeof d === 'string') return setErr(d);
        drafts.push(d);
      }
    }
    setBusy(true);
    setErr(null);
    try {
      await saveQuiz({
        id: quizId,
        class_id: meta.class_id,
        kind: meta.kind,
        title: meta.title.trim(),
        description: meta.description.trim(),
        due_at: meta.due ? new Date(meta.due).toISOString() : null,
        time_limit_minutes: meta.time_limit_minutes,
        passing_score: meta.passing_score,
        status,
        questions: drafts,
      });
      setDone(status);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const word = meta.kind === 'exam' ? 'exam' : 'quiz';
  return (
    <>
      <PageHeader
        title={isNew ? `Create ${word}` : `Edit ${word}`}
        subtitle={`${questions.length} question${questions.length === 1 ? '' : 's'} · ${totalPoints} points`}
        actions={
          <>
            <Link to="/quizzes" className="btn btn-secondary">
              Cancel
            </Link>
            <button className="btn btn-secondary" onClick={() => void save('draft')} disabled={busy}>
              Save as draft
            </button>
            <button className="btn btn-primary" onClick={() => void save('published')} disabled={busy}>
              {busy ? 'Saving…' : 'Publish'}
            </button>
          </>
        }
      />
      {err ? <ErrorNote message={err} /> : null}
      {locked ? (
        <div className="note gold">
          <Icon name="info" />
          <div>Students have already answered this {word}, so its questions are locked. You can still change the details below.</div>
        </div>
      ) : null}

      <div className="card">
        <CardHead title="Details" />
        <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-grid">
            <Field label="Type">
              <div className="view-toggle">
                {(['quiz', 'exam'] as const).map((k) => (
                  <button key={k} type="button" className={meta.kind === k ? 'on' : ''} onClick={() => setMeta({ ...meta, kind: k })}>
                    {k === 'quiz' ? 'Quiz' : 'Exam'}
                  </button>
                ))}
              </div>
            </Field>
            <ClassSelect classes={classes.data} value={meta.class_id} onChange={(class_id) => setMeta({ ...meta, class_id })} onCreated={classes.refresh} />
          </div>
          <Field label="Title">
            <input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="e.g. Midterm Exam – HTML & CSS" />
          </Field>
          <Field label="Instructions (optional)">
            <textarea className="textarea" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </Field>
          <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
            <Field label="Due date (optional)">
              <input className="input" type="datetime-local" value={meta.due} onChange={(e) => setMeta({ ...meta, due: e.target.value })} />
            </Field>
            <Field label="Time limit (minutes)">
              <input className="input" type="number" min={1} value={meta.time_limit_minutes} onChange={(e) => setMeta({ ...meta, time_limit_minutes: Number(e.target.value) })} />
            </Field>
            <Field label="Passing score (%)">
              <input className="input" type="number" min={0} max={100} value={meta.passing_score} onChange={(e) => setMeta({ ...meta, passing_score: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </div>

      {!locked ? (
        <>
          {questions.map((q, i) => (
            <div key={i} className="card">
              <CardHead
                title={`Question ${i + 1}`}
                right={
                  <div className="row">
                    <select className="select" style={{ width: 'auto' }} value={q.type} onChange={(e) => upd(i, { ...blankQ(e.target.value as QuestionType), prompt: q.prompt, points: q.points })}>
                      {QUESTION_TYPES.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-ghost btn-sm" disabled={questions.length === 1} onClick={() => setQuestions(questions.filter((_, qi) => qi !== i))} aria-label={`Remove question ${i + 1}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                }
              />
              <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-grid" style={{ gridTemplateColumns: q.type === 'enumeration' ? '1fr' : '1fr 110px' }}>
                  <Field label={q.type.includes('true_false') ? 'Statement' : 'Question'}>
                    <textarea className="textarea" style={{ minHeight: 60 }} value={q.prompt} onChange={(e) => upd(i, { prompt: e.target.value })} />
                  </Field>
                  {q.type !== 'enumeration' ? (
                    <Field label="Points">
                      <input className="input" type="number" min={1} max={100} value={q.points} onChange={(e) => upd(i, { points: Number(e.target.value) })} />
                    </Field>
                  ) : null}
                </div>
                <QuestionAnswer q={q} idx={i} onChange={(p) => upd(i, p)} />
              </div>
            </div>
          ))}
          <div className="row row-wrap">
            {QUESTION_TYPES.map((t) => (
              <button key={t.type} className="btn btn-secondary btn-sm" onClick={() => setQuestions([...questions, blankQ(t.type)])}>
                <Icon name="plus" size={13} /> {t.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {done ? (
        <Success
          title={done === 'published' ? `${meta.kind === 'exam' ? 'Exam' : 'Quiz'} published` : 'Draft saved'}
          body={done === 'published' ? 'Enrolled students can now answer it in the mobile app. Watch the scores under Results.' : 'Students can’t see it until you publish it.'}
          onDone={() => navigate('/quizzes')}
        />
      ) : null}
    </>
  );
}

function QuestionAnswer({ q, idx, onChange }: { q: EditQ; idx: number; onChange: (p: Partial<EditQ>) => void }) {
  const TrueFalse = (
    <Field label="Correct answer">
      <div className="view-toggle">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" className={q.truth === v ? 'on' : ''} onClick={() => onChange({ truth: v })}>
            {v ? 'True' : 'False'}
          </button>
        ))}
      </div>
    </Field>
  );
  switch (q.type) {
    case 'multiple_choice':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <small style={{ color: 'var(--text-soft)' }}>Choices — select the correct one</small>
          {q.choices.map((c, ci) => (
            <div key={ci} className="row">
              <input type="radio" name={`correct-${idx}`} checked={q.correct_index === ci} onChange={() => onChange({ correct_index: ci })} aria-label={`Choice ${ci + 1} is correct`} />
              <input className="input" value={c} placeholder={`Choice ${String.fromCharCode(65 + ci)}`} onChange={(e) => onChange({ choices: q.choices.map((x, xi) => (xi === ci ? e.target.value : x)) })} />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={q.choices.length <= 2}
                onClick={() => onChange({ choices: q.choices.filter((_, xi) => xi !== ci), correct_index: q.correct_index >= ci && q.correct_index > 0 ? q.correct_index - 1 : q.correct_index })}
                aria-label="Remove choice">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          {q.choices.length < 8 ? (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ choices: [...q.choices, ''] })}>
              <Icon name="plus" size={13} /> Add choice
            </button>
          ) : null}
        </div>
      );
    case 'true_false':
      return TrueFalse;
    case 'modified_true_false':
      return (
        <div className="form-grid">
          {TrueFalse}
          {!q.truth ? (
            <Field label="Word that makes it true" hint="Students who answer False must write this. Separate other accepted words with /.">
              <input className="input" value={q.correction} onChange={(e) => onChange({ correction: e.target.value })} />
            </Field>
          ) : null}
        </div>
      );
    case 'identification':
      return (
        <Field label="Correct answer" hint="Separate other accepted answers with /. Capital letters and extra spaces don’t matter.">
          <input className="input" value={q.accepted} onChange={(e) => onChange({ accepted: e.target.value })} placeholder="e.g. HyperText Markup Language / HTML" />
        </Field>
      );
    case 'enumeration':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <small style={{ color: 'var(--text-soft)' }}>Expected items — 1 point each. Separate other accepted spellings with /.</small>
          {q.items.map((it, ii) => (
            <div key={ii} className="row">
              <span style={{ width: 22, color: 'var(--muted)' }}>{ii + 1}.</span>
              <input className="input" value={it} onChange={(e) => onChange({ items: q.items.map((x, xi) => (xi === ii ? e.target.value : x)) })} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={q.items.length <= 1} onClick={() => onChange({ items: q.items.filter((_, xi) => xi !== ii) })} aria-label="Remove item">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ items: [...q.items, ''] })}>
            <Icon name="plus" size={13} /> Add item
          </button>
        </div>
      );
    case 'essay':
      return (
        <Field label="Grading guide (only you see this)" hint="You give the points for essays under Results.">
          <textarea className="textarea" style={{ minHeight: 60 }} value={q.guide} onChange={(e) => onChange({ guide: e.target.value })} />
        </Field>
      );
  }
}

/* ---------- Assignments & announcements ---------- */

function PostsPage({ kind }: { kind: 'assignments' | 'announcements' }) {
  const isTask = kind === 'assignments';
  const classes = useData(fetchMyClasses);
  const ids = classes.data?.map((c) => c.id) ?? [];
  const posts = useData(() => fetchPosts(ids), [ids.join(',')]);
  const [v, setV] = useState({ class_id: '', title: '', body: '', due: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [del, setDel] = useState<{ id: string; title: string; attachments?: Attachment[] } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);

  useEffect(() => {
    if (classes.data?.length && !v.class_id) setV((x) => ({ ...x, class_id: classes.data![0].id }));
  }, [classes.data, v.class_id]);

  const submit = async () => {
    if (!v.class_id) return setMsg({ text: 'Choose a class (or create one).', ok: false });
    if (!v.title.trim()) return setMsg({ text: 'Enter a title.', ok: false });
    if (!isTask && !v.body.trim()) return setMsg({ text: 'Write the announcement.', ok: false });
    setBusy(true);
    setMsg(null);
    try {
      if (isTask) {
        const big = files.find((f) => f.size > MAX_FILE_MB * 1048576);
        if (big) throw new Error(`“${big.name}” is larger than ${MAX_FILE_MB} MB.`);
        await postAssignment({ class_id: v.class_id, title: v.title, description: v.body, due_at: v.due ? new Date(v.due).toISOString() : null }, files);
        setFiles([]);
        setFileKey((k) => k + 1);
      }
      else await postAnnouncement({ class_id: v.class_id, title: v.title, message: v.body });
      setV({ ...v, title: '', body: '', due: '' });
      setMsg({ text: `${isTask ? 'Assignment' : 'Announcement'} posted. Enrolled students see it in the mobile app.`, ok: true });
      await posts.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const list = (isTask ? posts.data?.assignments : posts.data?.announcements) ?? [];
  const clsOf = (id: string) => classes.data?.find((c) => c.id === id);

  return (
    <>
      <PageHeader
        title={isTask ? 'Assignments' : 'Announcements'}
        subtitle={isTask ? 'Post tasks with a due date for a class.' : 'Send a message to everyone enrolled in a class.'}
      />
      {classes.error ? <ErrorNote message={classes.error} /> : null}
      <div className="grid grid-2-even" style={{ alignItems: 'start' }}>
        <div className="card">
          <CardHead title={isTask ? 'Post an assignment' : 'Post an announcement'} />
          {!classes.data ? (
            <Loading />
          ) : (
            <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <ClassSelect classes={classes.data} value={v.class_id} onChange={(class_id) => setV({ ...v, class_id })} onCreated={classes.refresh} />
              <Field label="Title">
                <input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={isTask ? 'e.g. Lab Activity 3 – Flexbox' : 'e.g. No class on Friday'} />
              </Field>
              <Field label={isTask ? 'Instructions (optional)' : 'Message'}>
                <textarea className="textarea" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
              </Field>
              {isTask ? (
                <Field label="Attachments (optional)" hint={`PDF, Word, PowerPoint, Excel, images or ZIP · up to ${MAX_FILE_MB} MB each`}>
                  <input
                    key={fileKey}
                    className="input"
                    type="file"
                    multiple
                    accept={ACCEPT_FILES}
                    onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])}
                  />
                </Field>
              ) : null}
              {isTask && files.length ? (
                <div className="attach-list">
                  {files.map((f, i) => (
                    <span key={i} className="attach-chip">
                      <Icon name="clipboard" size={13} /> {f.name} <small>{fmtSize(f.size)}</small>
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {isTask ? (
                <Field label="Due date (optional)">
                  <input className="input" type="datetime-local" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />
                </Field>
              ) : null}
              {msg ? msg.ok ? <div className="note"><Icon name="check" /><div>{msg.text}</div></div> : <ErrorNote message={msg.text} /> : null}
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void submit()} disabled={busy}>
                {busy ? 'Posting…' : isTask ? 'Post assignment' : 'Post announcement'}
              </button>
            </div>
          )}
        </div>
        <div className="card">
          <CardHead title={isTask ? 'Posted assignments' : 'Posted announcements'} sub={`${list.length} total`} />
          {!posts.data ? (
            <Loading />
          ) : list.length ? (
            <div className="list">
              {list.map((p) => (
                <div key={p.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <span className="ic">
                    <Icon name={isTask ? 'edit' : 'megaphone'} size={16} />
                  </span>
                  <div className="grow">
                    <b>{p.title}</b>
                    <small style={{ display: 'block' }}>{classLabel(clsOf(p.class_id))}</small>
                    <small style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{'description' in p ? p.description : p.message}</small>
                    {'attachments' in p && p.attachments?.length ? (
                      <div className="attach-list" style={{ marginTop: 6 }}>
                        {p.attachments.map((a) => (
                          <button
                            key={a.path}
                            type="button"
                            className="attach-chip link-chip"
                            onClick={async () => {
                              try {
                                window.open(await attachmentUrl(a), '_blank', 'noopener');
                              } catch (e) {
                                setMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
                              }
                            }}>
                            <Icon name="download" size={13} /> {a.name} <small>{fmtSize(a.size)}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <small style={{ display: 'block', color: 'var(--muted)' }}>
                      Posted {fmtDateTime(p.created_at)}
                      {'due_at' in p && p.due_at ? ` · Due ${fmtDateTime(p.due_at)}` : ''}
                    </small>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDel({ id: p.id, title: p.title, attachments: 'attachments' in p ? p.attachments : [] })} aria-label={`Delete ${p.title}`}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={isTask ? 'edit' : 'megaphone'} title={isTask ? 'No assignments yet' : 'No announcements yet'} />
          )}
        </div>
      </div>
      {del ? (
        <Confirm
          title={`Delete “${del.title}”?`}
          body={del.attachments?.length ? `Students will no longer see it, and its ${del.attachments.length} attached file(s) will be deleted.` : 'Students will no longer see it.'}
          confirmLabel="Delete"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deletePost(kind, del.id, del.attachments ?? []);
            setDel(null);
            await posts.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export const InstructorAssignments = () => <PostsPage kind="assignments" />;
export const InstructorAnnouncements = () => <PostsPage kind="announcements" />;

/* ---------- Results ---------- */

export function InstructorResults() {
  const { data, error } = useData(fetchQuizzes);
  const navigate = useNavigate();
  const published = data?.filter((q) => q.status === 'published') ?? [];
  const all = published.flatMap((q) => q.attempts);
  const avg = all.length ? Math.round(all.reduce((n, a) => n + pct(a), 0) / all.length) : null;
  const toGrade = all.filter((a) => a.needs_grading).length;
  return (
    <>
      <PageHeader title="Monitor Results" subtitle="Scores and completion for your published quizzes and exams." />
      {error ? <ErrorNote message={error} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-4">
            <Tile label="Published assessments" value={fmtNum(published.length)} />
            <Tile label="Submissions" value={fmtNum(all.length)} />
            <Tile label="Average score" value={avg == null ? '—' : `${avg}%`} />
            <Tile label="Essays to grade" value={fmtNum(toGrade)} sub={toGrade ? 'Open the quiz to grade' : 'All graded'} />
          </div>
          <div className="card">
            {published.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Class</th>
                      <th className="num">Submitted</th>
                      <th className="num">Average</th>
                      <th className="num">Passed</th>
                      <th className="num">To grade</th>
                      <th className="num" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {published.map((q) => {
                      const avgQ = q.attempts.length ? Math.round(q.attempts.reduce((n, a) => n + pct(a), 0) / q.attempts.length) : null;
                      const passed = q.attempts.filter((a) => pct(a) >= q.passing_score).length;
                      const grade = q.attempts.filter((a) => a.needs_grading).length;
                      return (
                        <tr key={q.id} className="clickable" onClick={() => navigate(`/results/${q.id}`)}>
                          <td>
                            <b>{q.title}</b> <span className="badge gray">{q.kind === 'exam' ? 'Exam' : 'Quiz'}</span>
                          </td>
                          <td>{classLabel(q.class)}</td>
                          <td className="num">
                            {q.attempts.length}/{q.enrolled}
                          </td>
                          <td className="num">{avgQ == null ? '—' : `${avgQ}%`}</td>
                          <td className="num">{q.attempts.length ? `${passed}/${q.attempts.length}` : '—'}</td>
                          <td className="num">{grade ? <span className="badge gold">{grade}</span> : '—'}</td>
                          <td className="num">
                            <Link to={`/results/${q.id}`} className="btn btn-secondary btn-sm" onClick={(e) => e.stopPropagation()}>
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="chart" title="No published assessments yet" body="Publish a quiz or exam and students’ scores appear here.">
                <Link to="/quizzes/new" className="btn btn-primary">
                  Create quiz / exam
                </Link>
              </Empty>
            )}
          </div>
        </>
      )}
    </>
  );
}

export function InstructorQuizResults() {
  const { id } = useParams();
  const quizzes = useData(fetchQuizzes);
  const q = quizzes.data?.find((x) => x.id === id);
  const roster = useData(() => (q ? fetchRoster(q.class_id) : Promise.resolve([])), [q?.class_id]);
  const [grading, setGrading] = useState<string | null>(null);

  if (quizzes.error) return <ErrorNote message={quizzes.error} />;
  if (!quizzes.data || !roster.data) return <Loading />;
  if (!q) return <Empty icon="chart" title="Assessment not found" body="It may have been deleted." />;

  const byEmail = new Map(q.attempts.map((a) => [a.student_email.toLowerCase(), a]));
  const extra = q.attempts.filter((a) => !roster.data!.some((s) => s.email.toLowerCase() === a.student_email.toLowerCase()));
  const rows = [
    ...roster.data.map((s) => ({ name: s.full_name || s.email, email: s.email, a: byEmail.get(s.email.toLowerCase()) })),
    ...extra.map((a) => ({ name: a.student_name, email: a.student_email, a })),
  ];
  const done = q.attempts;
  const avg = done.length ? Math.round(done.reduce((n, a) => n + pct(a), 0) / done.length) : null;
  const passed = done.filter((a) => pct(a) >= q.passing_score).length;

  const exportCsv = () =>
    downloadCsv(`${q.title.replace(/[^\w-]+/g, '_')}_results.csv`, [
      ['Student', 'Email', 'Status', 'Score', 'Total', 'Percent', 'Result', 'Submitted'],
      ...rows.map((r) => [r.name, r.email, r.a ? (r.a.needs_grading ? 'Needs grading' : 'Submitted') : 'Not yet', r.a?.score ?? '', r.a?.total ?? '', r.a ? `${pct(r.a)}%` : '', r.a ? (pct(r.a) >= q.passing_score ? 'Passed' : 'Failed') : '', r.a ? fmtDateTime(r.a.submitted_at) : '']),
    ]);

  return (
    <>
      <PageHeader
        title={q.title}
        subtitle={`${q.kind === 'exam' ? 'Exam' : 'Quiz'} · ${classLabel(q.class)} · passing ${q.passing_score}%`}
        actions={
          <>
            <Link to="/results" className="btn btn-secondary">
              <Icon name="arrowLeft" size={15} /> All results
            </Link>
            <button className="btn btn-secondary" onClick={exportCsv}>
              <Icon name="download" size={15} /> Export CSV
            </button>
          </>
        }
      />
      <div className="grid grid-4">
        <Tile label="Submitted" value={`${done.length}/${q.enrolled}`} sub={`${Math.max(0, q.enrolled - done.length)} not yet`} />
        <Tile label="Average score" value={avg == null ? '—' : `${avg}%`} />
        <Tile label="Passed" value={done.length ? `${passed}/${done.length}` : '—'} />
        <Tile label="Needs grading" value={fmtNum(done.filter((a) => a.needs_grading).length)} sub="Essay answers" />
      </div>
      <div className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                  <th className="num">Score</th>
                  <th className="num">%</th>
                  <th>Result</th>
                  <th>Submitted</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email}>
                    <td>
                      <b>{r.name}</b>
                      <small style={{ display: 'block', color: 'var(--text-soft)' }}>{r.email}</small>
                    </td>
                    <td>{r.a ? r.a.needs_grading ? <span className="badge gold">Needs grading</span> : <span className="badge green">Submitted</span> : <span className="badge gray">Not yet</span>}</td>
                    <td className="num">{r.a ? `${r.a.score}/${r.a.total}` : '—'}</td>
                    <td className="num">{r.a ? `${pct(r.a)}%` : '—'}</td>
                    <td>{r.a ? pct(r.a) >= q.passing_score ? <span className="badge green">Passed</span> : <span className="badge red">Failed</span> : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.a ? fmtDateTime(r.a.submitted_at) : '—'}</td>
                    <td className="num">
                      {r.a ? (
                        <button className={`btn btn-sm ${r.a.needs_grading ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setGrading(r.a!.id)}>
                          {r.a.needs_grading ? 'Grade' : 'View'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="users" title="No students enrolled" body="Add students to this class to see their results.">
            <Link to={`/classes?class=${q.class_id}`} className="btn btn-primary">Add students</Link>
          </Empty>
        )}
      </div>
      {grading ? (
        <GradeModal
          attemptId={grading}
          onClose={() => setGrading(null)}
          onSaved={async () => {
            setGrading(null);
            await quizzes.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function responseText(q: KeyedQuestion, r: unknown): ReactNode {
  if (r == null || (typeof r === 'object' && !Object.keys(r as object).length)) return <i style={{ color: 'var(--muted)' }}>No answer</i>;
  const x = r as { choice?: number; value?: boolean; correction?: string; text?: string; items?: string[] };
  if (typeof x.choice === 'number') return q.choices[x.choice] ?? `Choice ${x.choice + 1}`;
  if (typeof x.value === 'boolean') return `${x.value ? 'True' : 'False'}${x.correction ? ` → “${x.correction}”` : ''}`;
  if (typeof x.text === 'string') return <span style={{ whiteSpace: 'pre-wrap' }}>{x.text}</span>;
  if (Array.isArray(x.items)) return x.items.filter(Boolean).join(', ') || <i style={{ color: 'var(--muted)' }}>No answer</i>;
  return JSON.stringify(r);
}

function keyText(q: KeyedQuestion): string {
  const a = q.answer ?? {};
  switch (q.type) {
    case 'multiple_choice':
      return q.correct_index != null ? q.choices[q.correct_index] ?? '' : '';
    case 'true_false':
      return a.value ? 'True' : 'False';
    case 'modified_true_false':
      return a.value ? 'True' : `False → ${(a.accepted ?? []).join(' / ')}`;
    case 'identification':
      return (a.accepted ?? []).join(' / ');
    case 'enumeration':
      return (a.items ?? []).map((i) => i.join(' / ')).join(', ');
    case 'essay':
      return a.guide ? `Guide: ${a.guide}` : 'Graded by you';
  }
}

function GradeModal({ attemptId, onClose, onSaved }: { attemptId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data, error } = useData(() => fetchAttempt(attemptId), [attemptId]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const s: Record<string, number> = {};
    for (const it of data.attempt.item_scores ?? []) s[it.question_id] = it.points;
    setScores(s);
    setFeedback(data.attempt.feedback ?? '');
  }, [data]);

  const essays = data?.questions.filter((q) => q.type === 'essay') ?? [];
  const save = async () => {
    for (const q of essays) {
      const v = scores[q.id];
      if (v == null || Number.isNaN(v) || v < 0 || v > q.points) return setErr(`Give 0–${q.points} points for question ${q.position}.`);
    }
    setBusy(true);
    setErr(null);
    try {
      await gradeAttempt(attemptId, Object.fromEntries(essays.map((q) => [q.id, scores[q.id]])), feedback.trim());
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={data ? data.attempt.student_name || data.attempt.student_email : 'Loading…'}
      sub={data ? `Score ${data.attempt.score}/${data.attempt.total} · submitted ${fmtDateTime(data.attempt.submitted_at)}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {essays.length ? (
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !data}>
              {busy ? 'Saving…' : 'Save grade'}
            </button>
          ) : null}
        </>
      }>
      {error ? <ErrorNote message={error} /> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          {data.questions.map((q) => {
            const item = data.attempt.item_scores?.find((x) => x.question_id === q.id);
            const r = data.attempt.responses?.[q.position - 1] ?? (data.attempt.answers?.[q.position - 1] != null ? { choice: data.attempt.answers[q.position - 1] } : null);
            return (
              <div key={q.id} className="q-card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="q-label">
                    QUESTION {q.position} · {typeLabel(q.type).toUpperCase()}
                  </span>
                  {q.type === 'essay' ? (
                    <span className="row" style={{ gap: 6 }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={q.points}
                        style={{ width: 80 }}
                        value={scores[q.id] ?? ''}
                        onChange={(e) => setScores({ ...scores, [q.id]: e.target.value === '' ? NaN : Number(e.target.value) })}
                        aria-label={`Points for question ${q.position}`}
                      />
                      / {q.points}
                    </span>
                  ) : (
                    <span className={`badge ${item && item.points >= item.max ? 'green' : item && item.points > 0 ? 'gold' : 'red'}`}>
                      {item ? `${item.points}/${item.max}` : `0/${q.points}`}
                    </span>
                  )}
                </div>
                <div className="q-text">{q.prompt}</div>
                <div>
                  <small style={{ color: 'var(--text-soft)' }}>Answer: </small>
                  {responseText(q, r)}
                </div>
                <small style={{ color: 'var(--text-soft)' }}>Key: {keyText(q)}</small>
              </div>
            );
          })}
          <Field label="Feedback to the student (optional)">
            <textarea className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={!essays.length} />
          </Field>
          {err ? <ErrorNote message={err} /> : null}
        </>
      )}
    </Modal>
  );
}
