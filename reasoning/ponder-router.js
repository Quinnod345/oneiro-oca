import { Router } from 'express';

export function createPonderRouter({ ponderQueue, runPendingPonder, pursuitWork }) {
  const router = Router();
// Ponder — current evidence-bound engine, never the legacy unconsumed queue.
router.get('/ponder/request/:requestId', async (req, res) => {
  try {
    const chain = await ponderQueue.findRequest(req.params.requestId);
    res.status(chain ? 200 : 404).json(chain || { error: 'Request has not been saved yet' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/ponder', async (req, res) => {
  try {
    const chain = await ponderQueue.enqueue(req.body || {});
    if (req.body?.immediate === true) await runPendingPonder(chain.chain_id);
    res.status(req.body?.immediate === true ? 200 : 202).json(await ponderQueue.get(chain.chain_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/ponder/:id', async (req, res) => {
  try {
    const chain = await ponderQueue.get(req.params.id);
    res.status(chain ? 200 : 404).json(chain || { error: 'ponder chain not found' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
for (const action of ['evidence', 'outcome', 'cancel', 'retry']) {
  router.post(`/ponder/:id/${action}`, async (req, res) => {
    try {
        const result = action === 'evidence' ? await ponderQueue.addEvidence(req.params.id, req.body?.evidence)
        : action === 'outcome' ? await ponderQueue.outcome(req.params.id, req.body || {})
        : action === 'retry' ? await ponderQueue.retry(req.params.id) : await ponderQueue.cancel(req.params.id);
      if (action === 'cancel') await pursuitWork?.cancel(req.params.id);
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}

  return router;
}
