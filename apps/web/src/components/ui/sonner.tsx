import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

/**
 * Toast container. Mount once near the app root. Theme follows the document
 * `.dark` class via CSS variables.
 */
function Toaster(props: ToasterProps) {
	return (
		<SonnerToaster
			className="toaster group"
			toastOptions={{
				classNames: {
					toast:
						"group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-xs",
					description: "group-[.toast]:text-muted-foreground",
					actionButton:
						"group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
					cancelButton:
						"group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
				},
			}}
			{...props}
		/>
	);
}

export { Toaster };
