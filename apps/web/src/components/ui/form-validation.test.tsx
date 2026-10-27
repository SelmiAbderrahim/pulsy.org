import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { reactI18nextMock } from "@/test/i18n-mock";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible";
import { FormErrorSummary, useFormValidation } from "./form-validation";
vi.mock("react-i18next", () => reactI18nextMock());
it("keeps a submit target stable during blur and then focuses the first invalid field", () => {
  function Form() {
    const validation = useFormValidation();
    return <form ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); validation.validate(); }}>
      <FormErrorSummary issues={validation.issues} />
      <label htmlFor="submit-email">Email</label><input id="submit-email" type="email" required {...validation.field("submit-email")} />
      <button type="submit">Save</button>
    </form>;
  }
  render(<Form />);
  const email = screen.getByLabelText("Email"), save = screen.getByRole("button", { name: "Save" });
  fireEvent.change(email, { target: { value: "invalid" } });
  fireEvent.blur(email, { relatedTarget: save });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(save);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(email).toHaveFocus();
});
it("validates on blur and on each subsequent change, including after a submit attempt", () => {
  function TimedForm() {
    const validation = useFormValidation();
    return <form ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); validation.validate(); }}>
      <FormErrorSummary issues={validation.issues} />
      <label htmlFor="timed-email">Email</label><input id="timed-email" type="email" required {...validation.field("timed-email")} />
      <label htmlFor="timed-name">Name</label><input id="timed-name" required {...validation.field("timed-name")} />
      <button>Save</button>
    </form>;
  }
  render(<TimedForm />);
  const email = screen.getByLabelText("Email");
  fireEvent.change(email, { target: { value: "bad" } });
  expect(email).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.blur(email);
  expect(email).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(email, { target: { value: "still-bad" } });
  expect(email).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(email, { target: { value: "qa@example.test" } });
  expect(email).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const name = screen.getByLabelText("Name");
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: "QA" } });
  expect(name).not.toHaveAttribute("aria-invalid", "true");
});
function Example() {
  const validation = useFormValidation();
  return <form ref={validation.formRef}><label htmlFor="url">Webhook URL</label><input id="url" {...validation.field("url")} /><label htmlFor="headers">JSON headers</label><textarea id="headers" {...validation.field("headers")} /><FormErrorSummary issues={validation.issues} /><button type="button" onClick={() => validation.server({data:{validationErrors:{fieldErrors:{"webhookHeaders.nested":["First header error","Second header error"],webhookUrl:["Invalid target"]},formErrors:["Review configuration"]}}}, {webhookHeaders:"headers",webhookUrl:"url"})}>Validate</button></form>;
}
it("keeps specific nested errors without a redundant generic summary, associates their messages and focuses each linked field", () => {
  render(<Example />);
  fireEvent.click(screen.getByRole("button",{name:"Validate"}));
  expect(screen.getByLabelText("Webhook URL")).toHaveFocus();
  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByLabelText("JSON headers").getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  fireEvent.click(screen.getByRole("link",{name:"Webhook URL: Invalid target"}));
  expect(screen.getByLabelText("Webhook URL")).toHaveFocus();
  expect(screen.getByLabelText("Webhook URL")).toHaveAttribute("aria-invalid","true");
});

it("reveals every collapsed ancestor before focusing invalid fields and summary links", async () => {
  function CollapsedForm() {
    const validation = useFormValidation();
    return <form ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); validation.validate(); }}>
      <FormErrorSummary issues={validation.issues} />
      <Collapsible><CollapsibleTrigger>Advanced</CollapsibleTrigger><CollapsibleContent>
        <Collapsible><CollapsibleTrigger>Rule</CollapsibleTrigger><CollapsibleContent>
          <label htmlFor="advanced-url">Endpoint</label><input id="advanced-url" type="url" required {...validation.field("advanced-url")} />
        </CollapsibleContent></Collapsible>
      </CollapsibleContent></Collapsible><button type="submit">Save</button>
    </form>;
  }
  render(<CollapsedForm />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByLabelText("Endpoint")).toHaveFocus());
  expect(screen.getByLabelText("Endpoint")).toBeVisible();
  expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Rule" })).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.click(screen.getByRole("link", { name: "Endpoint: formValidation.required" }));
  await waitFor(() => expect(screen.getByLabelText("Endpoint")).toBeVisible());
  expect(screen.getByLabelText("Endpoint")).toHaveFocus();
});

it("uses clean accessible labels and legends instead of required markers or internal keys", () => {
  function Form() {
    const validation = useFormValidation();
    return <form ref={validation.formRef} noValidate onSubmit={event => { event.preventDefault(); validation.validate([{ id: "internal-componentIds", message: "Choose a component" }]); }}>
      <FormErrorSummary issues={validation.issues} />
      <label htmlFor="internal-title">Title <span aria-hidden="true">*</span></label><input id="internal-title" required />
      <fieldset id="internal-componentIds" tabIndex={-1}><legend>Affected components</legend></fieldset><button>Save</button>
    </form>;
  }
  render(<Form />); fireEvent.click(screen.getByText("Save"));
  expect(screen.getByRole("alert")).not.toHaveTextContent("internal-"); expect(screen.getByRole("alert")).not.toHaveTextContent("*");
  expect(screen.getByRole("link", { name: "Affected components: Choose a component" })).toBeInTheDocument();
  expect(screen.getByLabelText(/Title/)).toHaveFocus();
});


it.each(["server", "operation"])("preserves a %s error while its summary link receives pointer focus, then clears it after editing", async kind => {
  function Form() {
    const validation = useFormValidation();
    const reject = () => kind === "server"
      ? validation.server({ data: { validationErrors: { fieldErrors: { text: ["Invalid JSON"] } } } }, { text: "manifest" })
      : validation.show([{ id: "manifest", message: "Invalid JSON" }]);
    return <form ref={validation.formRef}>
      <FormErrorSummary issues={validation.issues} />
      <label htmlFor="manifest">Manifest</label><textarea id="manifest" {...validation.field("manifest")} />
      <button type="button" onClick={reject}>Preview</button>
    </form>;
  }
  const user = userEvent.setup();
  render(<Form />);
  const field = screen.getByLabelText("Manifest");
  await user.type(field, "broken JSON");
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(field).toHaveFocus());
  const link = screen.getByRole("link", { name: "Manifest: Invalid JSON" });
  await user.click(link);
  expect(link).toBeInTheDocument();
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute("aria-invalid", "true");
  await user.clear(field);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(field).not.toHaveAttribute("aria-invalid", "true");
});
