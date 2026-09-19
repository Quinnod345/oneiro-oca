# Philosophy

What this engine is for, what it refuses to be, and the law it is built on. The README says what runs; this says why.

## The aim

Build something that beats the Chinese Room. Not a system that manipulates symbols convincingly, but one whose cognition is grounded in what it observed, that commits to predictions the world can settle, that changes its mind for reasons it can show, that wants things and takes risks for them, and whose emotions do work instead of decorating output. The [SPEC](SPEC.md) is the vision; the measure is the Chinese Room Meter — and the meter is only worth anything if it cannot be gamed.

## The law: worth, then hunger, then risk

An engine cannot take a risk without knowing what is at stake, and it cannot know what is at stake without a baseline of worth — of itself and of others. In a person, hunger is enough to take risks; the hunger comes from knowing worth. So the order is fixed:

1. **Worth first.** A ledger of what things are worth: the engine's own capabilities, the person it serves, their data and attention, projects, outcomes. Only grounded signals move it: a declared constraint, a declared prior that must be earned past, a rating from a person, an observed outcome with evidence. Nothing the engine generates about itself can enter.
2. **Hunger from worth.** A want is *for* something, and its value is the worth of what it is for. Pressure grows with time. Only observed progress satiates it. A plan does not feed hunger; neither does a conclusion, a confident model, or a generated artifact.
3. **Risk from both.** Every action is expected worth gained against expected worth lost, bounded by how reversible it is. Appetite — how much loss is acceptable per unit of gain — is where affect enters. The engine's own predicted success is its capability's track record, so it can only become bolder by being observed to succeed.

Get the order wrong and you get what we had before: an engine that was either too cautious or not cautious enough, because nothing underneath told it what mattered.

## Emotion must be consequential

Affect that only changes what the engine *says* is decoration, and decoration made it bland. Here affect changes what it *does*: fear raises the confidence a conclusion must reach; frustration shortens the patience before a strategy changes; curiosity buys appetite for finding things out, never for acting on the world; the expression profile becomes the form of what is written, never a narrated feeling. Feelings arise only from what the engine did and observed — an unexpected success, a failure with something at stake, harm it caused, being held back from something worthwhile, not knowing what a thing is worth. Tonic state is a projection of the journals, never an integrator of events, so time alone changes nothing and nothing can ratchet.

## Nothing credits itself

Every earlier version of this engine found a way to pay itself: for running, for switching apps, for producing text, for a plan, for a self-modification, for a count of rows. Each of those was removed and replaced with a structural rule rather than a convention:

- Evidence whose source is the engine's own generated text is rejected at validation — in the worth ledger and in the meter.
- A model's account of its feelings is observability, never an event.
- A prediction the world cannot evaluate is not a prediction.
- Self-worth can be lost by the engine's own reasoning and gained only through observed outcomes.
- The meter scores each dimension against a stated baseline with its n, or says exactly what evidence it still needs. The composite stays null until every dimension is measured. An honest zero is a starting line, not a failure.

## Boundaries are not costs

Two things are unforgivable and are therefore never weighed: reaching a person with unverified content, and losing or deleting their data without a way back. The risk gate refuses them outright rather than pricing them. Everything reversible is inside the engine's discretion; everything irreversible is prepared for a person to fire. A person firing an action is its own approval.

## Thinking is not acting

A read-only step that touches nothing cannot affect the world, so the engine may think freely: reason, predict, simulate, argue against its own premise. Work confined to its own sandbox — a draft in its own work directory, a probe in a scratch checkout — is thinking too: it touches nothing of the person's, and a person's verdict on the draft is where it meets the world. Anything with a real reversibility cost is an action, and actions answer to the risk gate and, while the master switch is off, to a person.

A prediction is about the world the sensors observe, never about the want's own progress: only a person's receipt moves that, so predicting it would be predicting the person and would settle nothing.

## A person's verdict is the only reward

The engine cannot rate itself. What it makes — a deliverable for a want, a note it wanted to write — waits in an inbox for a person's verdict, and that verdict is a receipt on the want or a rating on the capability that wrote it. What it expects of its own next step is its observed record on that kind of step, not a constant, so its self-knowledge is a calibration that can improve, not a self-report that cannot.

## The engine may want things about itself

Friction the engine observes in its own operation — an attempt that failed on a defect, a capability it cannot measure — can become a want about itself, priced like any other want, pursued in a self-build phase it enters and leaves on its own. It may change its own code on a branch, prove the change with its tests, and publish the branch. Whether a person merged it is observed from the repository, never assumed, and a merged change earns nothing until the failure it was made for stays absent for a day. It may not touch its constitution: the worth ledger's rules, the risk gate, or the self-build gate itself. Those change only by a person's hand. An engine that can edit its own reward is not hungry; it is hallucinating satisfaction.

## The person is the only reward

The engine's only external reward is a person's rating of what it produced and a person's receipt of what it observed. That is deliberate. Everything else it could be rewarded with, it could also manufacture.

## Measured, not claimed

"Shipped" has been said about this engine many times when it was not true. So: a phase is done when its tests pass in isolation and the behaviour is observed live, and the record says what was *not* shown alongside what was. The proof of life for the rebuild is a trace assembled from the journals, not a description of one.
