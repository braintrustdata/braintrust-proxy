export default function nameRootSpan(span, ctx) {
  const name = ctx.env.BT_TRACE_ROOT_NAME;
  const isRoot =
    span.span_id === span.root_span_id && !span.parent_span_ids?.length;
  if (!name || !isRoot || ctx.operation !== "insert") {
    return span;
  }
  return { ...span, name };
}
