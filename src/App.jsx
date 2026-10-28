import { ArrowUpRight, GraduationCap, ShieldCheck } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import NecDemo from './components/NecDemo.jsx';
import SeatTable from './components/SeatTable.jsx';

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

export default function App() {
  const [dashboard, setDashboard] = useState({ transactions: [], quotas: [], students: [], paymentAvailable: false });
  const [studentName, setStudentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const processedOrder = useRef('');
  const orderFromReturn = new URLSearchParams(window.location.search).get('token');
  const cancelledCheckout = new URLSearchParams(window.location.search).get('checkout') === 'cancelled';

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await readResponse(await fetch('/api/dashboard'));
        if (active) setDashboard(data);
      } catch (error) {
        if (active) setNotice(error.message);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let subscription;
    fetch('/api/supabase-config')
      .then(readResponse)
      .then(async ({ url, publishableKey }) => {
        const client = createClient(url, publishableKey);
        setSupabase(client);
        setSession((await client.auth.getSession()).data.session);
        subscription = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)).data.subscription;
      })
      .catch((error) => setNotice(error.message));
    return () => subscription?.unsubscribe();
  }, []);

  function authHeaders() {
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setNotice(error ? error.message : 'Signed in.');
    setBusy(false);
  }

  async function signUp() {
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setNotice(error ? error.message : data.session ? 'Account created and signed in.' : 'Check your email to confirm the account, then sign in.');
    setBusy(false);
  }

  useEffect(() => {
    if (!orderFromReturn || !session || processedOrder.current === orderFromReturn) return;
    processedOrder.current = orderFromReturn;
    let active = true;
    setBusy(true);
    setNotice('PayPal approved the order. Confirming capture…');
    fetch(`/api/paypal/orders/${encodeURIComponent(orderFromReturn)}/capture`, { method: 'POST', headers: authHeaders() })
      .then(readResponse)
      .then(async ({ transaction }) => {
        if (!active) return;
        setNotice(`Payment captured. ${transaction.studentName}'s seat is unlocked.`);
        window.history.replaceState({}, '', window.location.pathname);
        setDashboard(await readResponse(await fetch('/api/dashboard')));
      })
      .catch((error) => active && setNotice(error.message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [orderFromReturn, session]);

  useEffect(() => {
    if (cancelledCheckout) setNotice('Checkout was cancelled. No seat was changed.');
  }, [cancelledCheckout]);

  async function beginCheckout(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('Creating a PayPal sandbox order…');
    try {
      const order = await readResponse(await fetch('/api/paypal/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ studentName }),
      }));
      window.location.assign(order.approvalUrl);
    } catch (error) {
      setNotice(error.message);
      setBusy(false);
    }
  }

  const quota = dashboard.quotas[0];

  return (
    <div className="dashboard-shell">
      <aside className="rail">
        <a className="brand" href="#top" aria-label="Sentinel dashboard">
          <span className="brand-icon"><GraduationCap size={20} /></span><span>sentinel<span className="brand-period">.</span></span>
        </a>
        <div className="rail-label">INSTRUCTOR</div>
        <a className="rail-link active" href="#overview">Overview</a>
        <a className="rail-link" href="#seat-ledger">Seat ledger</a>
        <a className="rail-link" href="#nec-demo">NEC demo</a>
        <div className="rail-bottom"><ShieldCheck size={16} /><span>Sandbox environment</span></div>
      </aside>

      <main id="top" className="content">
        <header className="topbar">
          <span className="breadcrumb">SENTINEL <span>/</span> INSTRUCTOR WORKSPACE</span>
          <span className="sandbox-chip"><i />PAYPAL SANDBOX</span>
        </header>

        <section id="overview" className="intro">
          <div>
            <p className="eyebrow">FALL 2026 COHORT</p>
            <h1>Make room for <em>what's next.</em></h1>
            <p className="subhead">Seat sales, payment confirmation, and student readiness in one place.</p>
          </div>
          <div className="seat-counter"><span>SEATS AVAILABLE</span><strong>{quota?.seatsAvailable ?? '—'}<small> / {quota?.capacity ?? '—'}</small></strong></div>
        </section>

        <section className="checkout-band" aria-label="Sandbox seat checkout">
          <div className="checkout-copy"><span className="checkout-marker">01</span><div><strong>Unlock one cohort seat</strong><span>$49.00 USD · sandbox checkout · capture on approval</span></div></div>
          {!session ? (
          <form className="checkout-form" onSubmit={signIn}>
            <label className="sr-only" htmlFor="account-email">Email</label>
            <input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" required />
            <label className="sr-only" htmlFor="account-password">Password</label>
            <input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" minLength="6" required />
            <button className="checkout-button" type="submit" disabled={busy || !supabase}>Sign in</button>
            <button className="checkout-button" type="button" onClick={signUp} disabled={busy || !supabase || !email || password.length < 6}>Create account</button>
          </form>
          ) : (
          <form className="checkout-form" onSubmit={beginCheckout}>
            <label className="sr-only" htmlFor="student-name">Student name</label>
            <input id="student-name" value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="Student name" maxLength="80" required />
            <button className="checkout-button" type="submit" disabled={busy || !dashboard.paymentAvailable || quota?.seatsAvailable === 0}>
              {busy ? 'Processing…' : dashboard.paymentAvailable ? 'Buy one seat' : 'Add sandbox credentials'}
              <ArrowUpRight size={16} />
            </button>
          </form>
          )}
        </section>
        {notice && <p className="notice" role="status">{notice}</p>}

        <section id="seat-ledger" className="ledger-section">
          <div className="section-title"><div><p className="eyebrow">LIVE COHORT LEDGER</p><h2>Seat activity</h2></div><span className="live-tag"><i />LIVE</span></div>
          <SeatTable transactions={dashboard.transactions} quotas={dashboard.quotas} students={dashboard.students} />
        </section>

        <section id="nec-demo" className="nec-section">
          <div className="section-title"><div><p className="eyebrow">REFERENCE FLOW / SAMPLE DATA</p><h2>NEC lookup demo</h2></div></div>
          <NecDemo />
        </section>
        <footer>Payments route only to PayPal Sandbox. Seat counts update only after a completed, verified capture.</footer>
      </main>
    </div>
  );
}