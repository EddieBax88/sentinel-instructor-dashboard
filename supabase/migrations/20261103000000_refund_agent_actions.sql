-- Agent-driven refunds: the seat assistant proposes a refund (refund_proposed) and the Confirm
-- click issues it (refund_issued) or fails (refund_failed / refund_rejected). agent_actions has a
-- check constraint on action, so the new names must be added before they can be logged; until
-- then the server only warns and the refund itself still works (logAgentAction never throws).
-- Safe to re-run: the constraint is dropped and recreated with the full list, in one transaction.
begin;

alter table public.agent_actions drop constraint if exists agent_actions_action_check;
alter table public.agent_actions
  add constraint agent_actions_action_check check (action in (
    'chat_request', 'tool_call', 'tool_rejected', 'order_proposed',
    'agent_reply', 'off_topic_blocked', 'confirm_rejected', 'order_created', 'order_failed',
    'refund_proposed', 'refund_issued', 'refund_failed', 'refund_rejected',
    'demo_reset'
  ));

commit;
