// Client bundle revision: projection-aware refresh for dsh 0.2.1 (2026-10-11).
// dsh-plugin-subagent-delete — web client glue.
//
// Permanent deletion removes the durable child session server-side, but an
// open client keeps its cached Session list and projection reads until
// something invalidates them. New subagents light the UI up through the
// `session/created -> api-session/added` frame path; this client mirrors that
// refresh for deletion:
//
//   * the host plugin publishes a transient child marker after every permanent
//     delete (official `sessions.prepare/enter/announce/detach` seam);
//   * this component subscribes to the sessions list snapshot, detects the
//     marker being removed (`api-session/removed`), and asks the sessions
//     service to reload the Host list and the parent's projection reads.
//
// Refresh uses the current public face: `sessions.refresh()` plus
// `sessions.refreshProjections(parentId)` (dsh >= 0.2.1). Older releases that
// spell the catalog reload `sessions.refreshSubagents(parentId)` are still
// supported. The parent Session's durable `subagent/catalog` facts are
// append-only, so a deleted child can remain a historical row in the header
// catalog dropdown until that parent log itself moves on; the sidebar Session
// list drops it as soon as this refresh lands.
//
// The component itself renders nothing: it is a lifecycle-only slot
// contribution mounted in the conversation header actions.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-subagent-delete',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports

    var react = require('react')
    var createElement = react.createElement
    var useEffect = react.useEffect
    var useRef = react.useRef
    var useState = react.useState

    var REFRESH_DEBOUNCE_MS = 350

    // The apply()-owned sessions service; one client instance per page.
    var sessionsService = null

    function parentIndex(snapshot) {
      var out = new Map()
      var byId = snapshot && snapshot.byId ? snapshot.byId : {}
      for (var id of Object.keys(byId)) {
        // The public sessions.list projection exposes lineage as `parentId`.
        out.set(id, byId[id].parentId)
      }
      return out
    }

    /** Reload the Host list and the parent's projections on the current face. */
    function refreshParents(sessions, parentsToRefresh) {
      if (typeof sessions.refresh === 'function') void sessions.refresh()
      if (typeof sessions.refreshProjections === 'function') {
        for (var parentId of parentsToRefresh) void sessions.refreshProjections(parentId)
        return
      }
      // dsh < 0.2.1 exposed the subagent-catalog reload under this name.
      if (typeof sessions.refreshSubagents === 'function') {
        for (var legacyParentId of parentsToRefresh) void sessions.refreshSubagents(legacyParentId)
      }
    }

    function UiSync(props) {
      var sessions = props.sessions
      var sessionId = props.sessionId

      var parentRef = useRef(sessionId)
      parentRef.current = sessionId
      var previousRef = useRef(null)
      var timerRef = useRef(null)

      useEffect(function () {
        var list = sessions && sessions.list
        if (!list || typeof list.subscribe !== 'function') return undefined

        previousRef.current = parentIndex(list.getSnapshot())

        var schedule = function (parents) {
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(function () {
            timerRef.current = null
            var parentsToRefresh = parents
            if (parentRef.current !== undefined && parentRef.current !== null) {
              parentsToRefresh = new Set(parentsToRefresh)
              parentsToRefresh.add(parentRef.current)
            }
            refreshParents(sessions, parentsToRefresh)
          }, REFRESH_DEBOUNCE_MS)
        }

        var dispose = list.subscribe(function () {
          var snapshot = list.getSnapshot()
          var previous = previousRef.current
          previousRef.current = parentIndex(snapshot)
          if (!previous) return

          var parents = new Set()
          for (var entry of previous) {
            var id = entry[0]
            var parentId = entry[1]
            if (parentId === undefined || parentId === null) continue
            if (snapshot.byId[id] === undefined) parents.add(parentId)
          }
          if (parents.size > 0) schedule(parents)
        })

        return function () {
          dispose()
          if (timerRef.current !== null) clearTimeout(timerRef.current)
        }
      }, [sessions])

      return null
    }

    /** Stable slot component: the registration identity must not churn. */
    function HeaderSlot(props) {
      return createElement(UiSync, { sessionId: props.sessionId, sessions: sessionsService })
    }


    /** Manual cleanup panel: list this session's subagents and delete on click. */
    function CleanerSlot(props) {
      var sessionId = props.sessionId
      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var rowsState = useState([])
      var rows = rowsState[0]
      var setRows = rowsState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var noteState = useState('')
      var note = noteState[0]
      var setNote = noteState[1]

      function load() {
        if (!sessionId) return
        fetch('/dsh-plugin-subagent-delete/list?parentSessionId=' + encodeURIComponent(sessionId))
          .then(function (res) { return res.json() })
          .then(function (data) { setRows((data && data.subagents) || []) })
          .catch(function () { setNote('读取失败') })
      }

      function del(id) {
        setBusy(true)
        fetch('/dsh-plugin-subagent-delete/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentSessionId: sessionId, subagentId: id }),
        })
          .then(function (res) { return res.json() })
          .then(function (data) {
            setNote(data && data.ok ? '已删除' : ('失败：' + ((data && data.error) || '未知')))
            load()
            refreshParents(sessionsService, [sessionId])
          })
          .catch(function (err) { setNote('失败：' + err.message) })
          .then(function () { setBusy(false) })
      }

      function cleanAll() {
        setBusy(true)
        fetch('/dsh-plugin-subagent-delete/cleanup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId }),
        })
          .then(function (res) { return res.json() })
          .then(function (data) {
            if (!data || !data.ok) { setNote('失败：' + ((data && data.error) || '未知')); return }
            setNote('已删 ' + data.deleted + ' 个' + (data.queued > 0 ? '，记录待重启后同步' : ''))
            load()
            refreshParents(sessionsService, [sessionId])
          })
          .catch(function (err) { setNote('失败：' + err.message) })
          .then(function () { setBusy(false) })
      }

      if (!sessionId) return null
      var button = createElement('button', {
        type: 'button',
        onClick: function () { var next = !open; setOpen(next); if (next) load() },
        title: '管理本会话的子代理',
        style: { fontSize: '12px', padding: '2px 8px', borderRadius: '6px', border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' },
      }, '子代理')

      if (!open) return button

      var items = rows.map(function (row) {
        return createElement('div', {
          key: row.id,
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f2f4f7' },
        }, [
          createElement('div', { key: 'meta', style: { flex: '1', fontSize: '12px', color: '#475467' } },
            (row.label || row.id.slice(0, 8)) + ' · ' + (row.mode || '') + ' · ' + (row.activity || '') + (row.present === false ? ' · 已删' : '')),
          createElement('button', {
            key: 'del',
            type: 'button',
            disabled: busy || row.present === false,
            onClick: function () { del(row.id) },
            style: { fontSize: '12px', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fda29b', background: '#fff5f4', color: '#b42318', cursor: 'pointer' },
          }, '删'),
        ])
      })

      var panel = createElement('div', {
        style: {
          position: 'fixed', top: '64px', right: '16px', width: '360px', maxHeight: '60vh', overflow: 'auto',
          background: '#fff', border: '1px solid #d0d5dd', borderRadius: '10px', boxShadow: '0 12px 32px rgba(16,24,40,.12)',
          padding: '12px', zIndex: 9999, fontFamily: 'inherit',
        },
      }, [
        createElement('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
          createElement('strong', { key: 't', style: { flex: '1', fontSize: '13px' } }, '本会话子代理 ' + rows.length + ' 个'),
          createElement('button', {
            key: 'all', type: 'button', disabled: busy,
            onClick: cleanAll,
            style: { fontSize: '12px', padding: '2px 8px', borderRadius: '6px', border: '1px solid #d0d5dd', background: '#f9fafb', cursor: 'pointer' },
          }, busy ? '处理中…' : '一键清理'),
          createElement('button', {
            key: 'x', type: 'button', onClick: function () { setOpen(false) },
            style: { fontSize: '12px', padding: '2px 8px', borderRadius: '6px', border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer' },
          }, '关闭'),
        ]),
        note ? createElement('div', { key: 'note', style: { fontSize: '12px', color: '#475467', marginBottom: '6px' } }, note) : null,
        items.length ? items : createElement('div', { key: 'empty', style: { fontSize: '12px', color: '#98a2b3' } }, '没有子代理'),
      ])

      return createElement('span', null, button, panel)
    }

    exports.name = 'dsh-plugin-subagent-delete/client'
    exports.inject = ['slots', 'sessions']

    exports.apply = function apply(ctx) {
      sessionsService = ctx.sessions
      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'subagent-delete-refresh',
          order: 100,
        }, HeaderSlot)
      })

      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'subagent-delete-cleaner',
          order: 90,
        }, CleanerSlot)
      })
    }

    return module.exports
  },
})
