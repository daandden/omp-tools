Ask the user to fill in one HTML form; blocks until they submit or cancel.

Ask only for materially different tradeoffs the user must decide. Default: act using code/config/docs/history and conventions. Several viable choices: pick conservative/standard, proceed, state choice.

<instruction>
- `html`: one `<form>` of plain semantic HTML, rendered natively in the user's terminal. NEVER `<script>`, `<style>`, or `style=`.
- Every control needs a `name`. You receive the submitted form data as JSON `{"name": value}`: a radio group or `<select>` gives the chosen `value`; a checkbox group (shared name) or `<select multiple>` gives an array; a lone checkbox or radio group left unchecked is omitted.
- One-of: `<input type="radio">`; many-of: `type="checkbox"`; long lists: `<select>`. Wrap each control in a `<label>`; group a question in a `<fieldset>` with a `<legend>`, or put it in a `<p>` right before the group.
- Radio and checkbox groups automatically get an "Other" free-text answer: its text arrives as the radio's value, or as an extra checkbox array entry. NEVER add your own "Other" option or a text field for it.
- Only choice controls for now: NEVER `<textarea>` or a text, number, date, email, or url `<input>`. `required` is enforced.
- Preselect your recommendation with `checked`/`selected`. If the user does not answer in time, those values are submitted.
- Context the user needs to decide (findings, tradeoffs, diffs, drafts) goes inside the form: `<p>`, `<ul>`, `<table>`, `<pre>`.
- Pictures: `<img src="…" alt="…">` (an http(s) URL, a `data:` URI, or a file path relative to the working directory) and inline `<svg>` diagrams, as their own blocks; inside a `<label>` an image shows only its `alt`.
- NEVER add buttons (`<button>`, `type="submit"`): the UI supplies Submit and Cancel.
- Keep forms short: a few questions with distinct options; ask follow-ups in a later call.
</instruction>
