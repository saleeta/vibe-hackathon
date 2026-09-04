# Person B end-to-end demo

Runs B1 → B2 → B4/B5 → B3 → B6 in plain Node, simulating a plate being eaten
over several detected frames — including a duplicate look at the same bite of
chicken (must not double count) and a later, separate handful of chicken
(must count as new intake). No Lens Studio or hardware needed.

```bash
# terminal 1
cd ../nutrition-service
npm install
npm run dev

# terminal 2
cd examples
npm install
npm start
```

Expected shape of the output: per-frame confidence lines, a pre-close session
table, then the closed `Eating Session` with per-food weights, macro totals,
and a confidence breakdown (eating/food/portion/overall).
