// ---------------------------------------------------------------------------
// Lightweight backend translator.
//
// No i18next runtime needed for the server's small error catalog: a flat
// dictionary keyed by language -> key -> string, with `{{var}}` interpolation
// and an en -> key fallback chain.
// ---------------------------------------------------------------------------

export type SupportedLanguage = "en" | "ar" | "fr" | "de" | "es";

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
	"en",
	"ar",
	"fr",
	"de",
	"es",
] as const;

export type Translator = (
	key: string,
	vars?: Record<string, string | number>,
) => string;

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

type Dictionary = Record<string, string>;

export const DICTIONARIES: Record<SupportedLanguage, Dictionary> = {
	en: {
		"errors.notFound": "{{resource}} not found",
		"errors.unauthorized": "You must be signed in to do that",
		"errors.forbidden": "You do not have permission to do that",
		"errors.badRequest": "Invalid request",
		"errors.invalidInput": "Invalid input: {{details}}",
		"errors.internal": "Something went wrong",
		"errors.cannotCheckInactive": "Cannot check an inactive monitor",
		"errors.testEmailFailed": "Failed to send test email: {{details}}",
		"errors.testNotificationFailed":
			"Failed to send test notification: {{details}}",
		"errors.unsafeUrl": "The provided URL is not allowed",
		"errors.shareLinkExpired": "This share link has expired",
		"errors.statusPageSlugTaken":
			"You already have a status page with this slug",
		"errors.statusPageDefaultProtected":
			"The default status page can't be deleted or renamed.",
		"errors.customDomainTaken":
			"This domain is already in use on another status page",
		"errors.customDomainNotVerified":
			"This domain is not verified. Add the TXT record and try again.",
		"errors.shareLinkEmptySelection":
			"None of the selected monitors are available to add",
		"errors.apiKeyInvalid": "The provided API key is invalid.",
		"errors.apiKeyRevoked": "This API key has been revoked.",
		"errors.apiKeyNotFound": "API key not found.",
		"errors.rateLimited":
			"Too many requests. Retry after {{retryAfter}} seconds.",
		"errors.notOrgMember":
			"You are not a member of this organization.",
		"errors.orgSlugTaken": "That organization slug is already taken.",
		"errors.orgOwnerCannotLeave":
			"The owner cannot leave the organization; transfer ownership or delete the organization instead.",
		"errors.orgMemberAlreadyExists":
			"That user is already a member of this organization.",
		"errors.orgInviteUserNotFound":
			"No Pulsy account was found for {{email}}. Ask them to sign up first.",
		"errors.cannotModifySelf":
			"You cannot perform this action on your own account.",
		"errors.lastSuperadmin":
			"You cannot remove the last remaining superadmin.",
		// SLA reports (PDF + monthly email)
		"slaReport.pdfTitle": "SLA / Uptime Report",
		"slaReport.monitor": "Monitor",
		"slaReport.url": "URL",
		"slaReport.period": "Period",
		"slaReport.uptime": "Uptime",
		"slaReport.totalChecks": "Total checks",
		"slaReport.successfulChecks": "Successful checks",
		"slaReport.failedChecks": "Failed checks",
		"slaReport.avgResponseTime": "Average response time",
		"slaReport.p95ResponseTime": "p95 response time",
		"slaReport.incidents": "Incidents",
		"slaReport.noIncidents": "No incidents in this period",
		"slaReport.incidentCount": "Incident count",
		"slaReport.totalDowntime": "Total downtime",
		"slaReport.longestIncident": "Longest incident",
		"slaReport.dailyUptime": "Daily uptime",
		"slaReport.noData": "No data for this period",
		"slaReport.generatedAt": "Generated at",
		"slaReport.emailSubject": "SLA report for {{monitor}} — {{period}}",
		"slaReport.emailIntro": "Here is your SLA report for {{monitor}} ({{period}}).",
		"slaReport.downloadPdf": "Download full PDF",
		"slaReport.footer": "Sent by Pulsy",
	},
	ar: {
		"errors.notFound": "{{resource}} غير موجود",
		"errors.unauthorized": "يجب تسجيل الدخول للقيام بذلك",
		"errors.forbidden": "ليس لديك إذن للقيام بذلك",
		"errors.badRequest": "طلب غير صالح",
		"errors.invalidInput": "إدخال غير صالح: {{details}}",
		"errors.internal": "حدث خطأ ما",
		"errors.cannotCheckInactive": "لا يمكن فحص مراقب غير نشط",
		"errors.testEmailFailed": "فشل إرسال البريد التجريبي: {{details}}",
		"errors.testNotificationFailed": "فشل إرسال الإشعار التجريبي: {{details}}",
		"errors.unsafeUrl": "الرابط المقدم غير مسموح به",
		"errors.shareLinkExpired": "انتهت صلاحية رابط المشاركة هذا",
		"errors.statusPageSlugTaken":
			"لديك بالفعل صفحة حالة بهذا المعرّف",
		"errors.statusPageDefaultProtected":
			"لا يمكن حذف صفحة الحالة الافتراضية أو إعادة تسميتها.",
		"errors.customDomainTaken":
			"هذا النطاق مستخدم بالفعل في صفحة حالة أخرى",
		"errors.customDomainNotVerified":
			"لم يتم التحقق من هذا النطاق. أضف سجل TXT وحاول مرة أخرى.",
		"errors.shareLinkEmptySelection":
			"لا تتوفر أي من المراقبات المحددة للإضافة",
		"errors.apiKeyInvalid": "مفتاح واجهة برمجة التطبيقات المقدَّم غير صالح.",
		"errors.apiKeyRevoked": "تم إلغاء مفتاح واجهة برمجة التطبيقات هذا.",
		"errors.apiKeyNotFound": "لم يتم العثور على مفتاح واجهة برمجة التطبيقات.",
		"errors.rateLimited":
			"عدد كبير جدًا من الطلبات. أعد المحاولة بعد {{retryAfter}} ثانية.",
		"errors.notOrgMember":
			"أنت لست عضوًا في هذه المؤسسة.",
		"errors.orgSlugTaken": "اسم المؤسسة المختصر مستخدم بالفعل.",
		"errors.orgOwnerCannotLeave":
			"لا يمكن للمالك مغادرة المؤسسة؛ انقل الملكية أو احذف المؤسسة بدلاً من ذلك.",
		"errors.orgMemberAlreadyExists":
			"هذا المستخدم عضو في المؤسسة بالفعل.",
		"errors.orgInviteUserNotFound":
			"لم يتم العثور على حساب Pulsy لـ {{email}}. اطلب منهم التسجيل أولاً.",
		"errors.cannotModifySelf": "لا يمكنك تنفيذ هذا الإجراء على حسابك الخاص.",
		"errors.lastSuperadmin": "لا يمكنك إزالة آخر مشرف عام متبقٍ.",
		// SLA reports (PDF + monthly email)
		"slaReport.pdfTitle": "تقرير SLA / وقت التشغيل",
		"slaReport.monitor": "المراقب",
		"slaReport.url": "الرابط",
		"slaReport.period": "الفترة",
		"slaReport.uptime": "وقت التشغيل",
		"slaReport.totalChecks": "إجمالي الفحوصات",
		"slaReport.successfulChecks": "الفحوصات الناجحة",
		"slaReport.failedChecks": "الفحوصات الفاشلة",
		"slaReport.avgResponseTime": "متوسط زمن الاستجابة",
		"slaReport.p95ResponseTime": "زمن استجابة p95",
		"slaReport.incidents": "الحوادث",
		"slaReport.noIncidents": "لا توجد حوادث في هذه الفترة",
		"slaReport.incidentCount": "عدد الحوادث",
		"slaReport.totalDowntime": "إجمالي وقت التعطل",
		"slaReport.longestIncident": "أطول حادثة",
		"slaReport.dailyUptime": "وقت التشغيل اليومي",
		"slaReport.noData": "لا توجد بيانات لهذه الفترة",
		"slaReport.generatedAt": "تم الإنشاء في",
		"slaReport.emailSubject": "تقرير SLA لـ {{monitor}} — {{period}}",
		"slaReport.emailIntro": "إليك تقرير SLA الخاص بـ {{monitor}} ({{period}}).",
		"slaReport.downloadPdf": "تنزيل ملف PDF الكامل",
		"slaReport.footer": "أُرسل بواسطة Pulsy",
	},
	fr: {
		"errors.notFound": "{{resource}} introuvable",
		"errors.unauthorized": "Vous devez être connecté pour faire cela",
		"errors.forbidden": "Vous n'avez pas la permission de faire cela",
		"errors.badRequest": "Requête invalide",
		"errors.invalidInput": "Entrée invalide : {{details}}",
		"errors.internal": "Une erreur est survenue",
		"errors.cannotCheckInactive": "Impossible de vérifier un moniteur inactif",
		"errors.testEmailFailed": "Échec de l'envoi de l'e-mail de test : {{details}}",
		"errors.testNotificationFailed":
			"Échec de l'envoi de la notification de test : {{details}}",
		"errors.unsafeUrl": "L'URL fournie n'est pas autorisée",
		"errors.shareLinkExpired": "Ce lien de partage a expiré",
		"errors.statusPageSlugTaken":
			"Vous avez déjà une page de statut avec cet identifiant",
		"errors.statusPageDefaultProtected":
			"La page de statut par défaut ne peut pas être supprimée ni renommée.",
		"errors.customDomainTaken":
			"Ce domaine est déjà utilisé sur une autre page de statut",
		"errors.customDomainNotVerified":
			"Ce domaine n'est pas vérifié. Ajoutez l'enregistrement TXT et réessayez.",
		"errors.shareLinkEmptySelection":
			"Aucun des moniteurs sélectionnés n'est disponible à l'ajout",
		"errors.apiKeyInvalid": "La clé API fournie est invalide.",
		"errors.apiKeyRevoked": "Cette clé API a été révoquée.",
		"errors.apiKeyNotFound": "Clé API introuvable.",
		"errors.rateLimited":
			"Trop de requêtes. Réessayez dans {{retryAfter}} secondes.",
		"errors.notOrgMember":
			"Vous n'êtes pas membre de cette organisation.",
		"errors.orgSlugTaken": "Ce slug d'organisation est déjà pris.",
		"errors.orgOwnerCannotLeave":
			"Le propriétaire ne peut pas quitter l'organisation ; transférez la propriété ou supprimez l'organisation à la place.",
		"errors.orgMemberAlreadyExists":
			"Cet utilisateur est déjà membre de cette organisation.",
		"errors.orgInviteUserNotFound":
			"Aucun compte Pulsy trouvé pour {{email}}. Demandez-leur de s'inscrire d'abord.",
		"errors.cannotModifySelf":
			"Vous ne pouvez pas effectuer cette action sur votre propre compte.",
		"errors.lastSuperadmin":
			"Vous ne pouvez pas supprimer le dernier superadministrateur restant.",
		// SLA reports (PDF + monthly email)
		"slaReport.pdfTitle": "Rapport SLA / disponibilité",
		"slaReport.monitor": "Moniteur",
		"slaReport.url": "URL",
		"slaReport.period": "Période",
		"slaReport.uptime": "Disponibilité",
		"slaReport.totalChecks": "Vérifications totales",
		"slaReport.successfulChecks": "Vérifications réussies",
		"slaReport.failedChecks": "Vérifications échouées",
		"slaReport.avgResponseTime": "Temps de réponse moyen",
		"slaReport.p95ResponseTime": "Temps de réponse p95",
		"slaReport.incidents": "Incidents",
		"slaReport.noIncidents": "Aucun incident sur cette période",
		"slaReport.incidentCount": "Nombre d'incidents",
		"slaReport.totalDowntime": "Indisponibilité totale",
		"slaReport.longestIncident": "Incident le plus long",
		"slaReport.dailyUptime": "Disponibilité quotidienne",
		"slaReport.noData": "Aucune donnée pour cette période",
		"slaReport.generatedAt": "Généré le",
		"slaReport.emailSubject": "Rapport SLA pour {{monitor}} — {{period}}",
		"slaReport.emailIntro": "Voici votre rapport SLA pour {{monitor}} ({{period}}).",
		"slaReport.downloadPdf": "Télécharger le PDF complet",
		"slaReport.footer": "Envoyé par Pulsy",
	},
	de: {
		"errors.notFound": "{{resource}} nicht gefunden",
		"errors.unauthorized": "Sie müssen angemeldet sein, um dies zu tun",
		"errors.forbidden": "Sie haben keine Berechtigung dafür",
		"errors.badRequest": "Ungültige Anfrage",
		"errors.invalidInput": "Ungültige Eingabe: {{details}}",
		"errors.internal": "Etwas ist schiefgelaufen",
		"errors.cannotCheckInactive":
			"Ein inaktiver Monitor kann nicht geprüft werden",
		"errors.testEmailFailed": "Test-E-Mail konnte nicht gesendet werden: {{details}}",
		"errors.testNotificationFailed":
			"Test-Benachrichtigung konnte nicht gesendet werden: {{details}}",
		"errors.unsafeUrl": "Die angegebene URL ist nicht erlaubt",
		"errors.shareLinkExpired": "Dieser Freigabelink ist abgelaufen",
		"errors.statusPageSlugTaken":
			"Sie haben bereits eine Statusseite mit diesem Slug",
		"errors.statusPageDefaultProtected":
			"Die Standard-Statusseite kann nicht gelöscht oder umbenannt werden.",
		"errors.customDomainTaken":
			"Diese Domain wird bereits auf einer anderen Statusseite verwendet",
		"errors.customDomainNotVerified":
			"Diese Domain ist nicht verifiziert. Fügen Sie den TXT-Eintrag hinzu und versuchen Sie es erneut.",
		"errors.shareLinkEmptySelection":
			"Keiner der ausgewählten Monitore ist zum Hinzufügen verfügbar",
		"errors.apiKeyInvalid": "Der angegebene API-Schlüssel ist ungültig.",
		"errors.apiKeyRevoked": "Dieser API-Schlüssel wurde widerrufen.",
		"errors.apiKeyNotFound": "API-Schlüssel nicht gefunden.",
		"errors.rateLimited":
			"Zu viele Anfragen. Erneut versuchen in {{retryAfter}} Sekunden.",
		"errors.notOrgMember":
			"Sie sind kein Mitglied dieser Organisation.",
		"errors.orgSlugTaken": "Dieser Organisations-Slug ist bereits vergeben.",
		"errors.orgOwnerCannotLeave":
			"Der Eigentümer kann die Organisation nicht verlassen; übertragen Sie die Eigentümerschaft oder löschen Sie stattdessen die Organisation.",
		"errors.orgMemberAlreadyExists":
			"Dieser Benutzer ist bereits Mitglied dieser Organisation.",
		"errors.orgInviteUserNotFound":
			"Kein Pulsy-Konto für {{email}} gefunden. Bitten Sie sie, sich zuerst zu registrieren.",
		"errors.cannotModifySelf":
			"Sie können diese Aktion nicht für Ihr eigenes Konto ausführen.",
		"errors.lastSuperadmin":
			"Sie können den letzten verbleibenden Superadministrator nicht entfernen.",
		// SLA reports (PDF + monthly email)
		"slaReport.pdfTitle": "SLA-/Verfügbarkeitsbericht",
		"slaReport.monitor": "Monitor",
		"slaReport.url": "URL",
		"slaReport.period": "Zeitraum",
		"slaReport.uptime": "Verfügbarkeit",
		"slaReport.totalChecks": "Prüfungen gesamt",
		"slaReport.successfulChecks": "Erfolgreiche Prüfungen",
		"slaReport.failedChecks": "Fehlgeschlagene Prüfungen",
		"slaReport.avgResponseTime": "Durchschnittliche Antwortzeit",
		"slaReport.p95ResponseTime": "p95-Antwortzeit",
		"slaReport.incidents": "Vorfälle",
		"slaReport.noIncidents": "Keine Vorfälle in diesem Zeitraum",
		"slaReport.incidentCount": "Anzahl der Vorfälle",
		"slaReport.totalDowntime": "Gesamtausfallzeit",
		"slaReport.longestIncident": "Längster Vorfall",
		"slaReport.dailyUptime": "Tägliche Verfügbarkeit",
		"slaReport.noData": "Keine Daten für diesen Zeitraum",
		"slaReport.generatedAt": "Erstellt am",
		"slaReport.emailSubject": "SLA-Bericht für {{monitor}} — {{period}}",
		"slaReport.emailIntro": "Hier ist Ihr SLA-Bericht für {{monitor}} ({{period}}).",
		"slaReport.downloadPdf": "Vollständiges PDF herunterladen",
		"slaReport.footer": "Gesendet von Pulsy",
	},
	es: {
		"errors.notFound": "{{resource}} no encontrado",
		"errors.unauthorized": "Debes iniciar sesión para hacer eso",
		"errors.forbidden": "No tienes permiso para hacer eso",
		"errors.badRequest": "Solicitud no válida",
		"errors.invalidInput": "Entrada no válida: {{details}}",
		"errors.internal": "Algo salió mal",
		"errors.cannotCheckInactive": "No se puede comprobar un monitor inactivo",
		"errors.testEmailFailed":
			"No se pudo enviar el correo de prueba: {{details}}",
		"errors.testNotificationFailed":
			"No se pudo enviar la notificación de prueba: {{details}}",
		"errors.unsafeUrl": "La URL proporcionada no está permitida",
		"errors.shareLinkExpired": "Este enlace para compartir ha caducado",
		"errors.statusPageSlugTaken":
			"Ya tienes una página de estado con este identificador",
		"errors.statusPageDefaultProtected":
			"La página de estado predeterminada no se puede eliminar ni renombrar.",
		"errors.customDomainTaken":
			"Este dominio ya está en uso en otra página de estado",
		"errors.customDomainNotVerified":
			"Este dominio no está verificado. Añade el registro TXT e inténtalo de nuevo.",
		"errors.shareLinkEmptySelection":
			"Ninguno de los monitores seleccionados está disponible para añadir",
		"errors.apiKeyInvalid": "La clave API proporcionada no es válida.",
		"errors.apiKeyRevoked": "Esta clave API ha sido revocada.",
		"errors.apiKeyNotFound": "Clave API no encontrada.",
		"errors.rateLimited":
			"Demasiadas solicitudes. Vuelve a intentarlo en {{retryAfter}} segundos.",
		"errors.notOrgMember":
			"No eres miembro de esta organización.",
		"errors.orgSlugTaken": "Ese slug de organización ya está en uso.",
		"errors.orgOwnerCannotLeave":
			"El propietario no puede abandonar la organización; transfiere la propiedad o elimina la organización en su lugar.",
		"errors.orgMemberAlreadyExists":
			"Ese usuario ya es miembro de esta organización.",
		"errors.orgInviteUserNotFound":
			"No se encontró ninguna cuenta de Pulsy para {{email}}. Pídeles que se registren primero.",
		"errors.cannotModifySelf":
			"No puedes realizar esta acción en tu propia cuenta.",
		"errors.lastSuperadmin":
			"No puedes eliminar al último superadministrador restante.",
		// SLA reports (PDF + monthly email)
		"slaReport.pdfTitle": "Informe de SLA / disponibilidad",
		"slaReport.monitor": "Monitor",
		"slaReport.url": "URL",
		"slaReport.period": "Período",
		"slaReport.uptime": "Disponibilidad",
		"slaReport.totalChecks": "Comprobaciones totales",
		"slaReport.successfulChecks": "Comprobaciones exitosas",
		"slaReport.failedChecks": "Comprobaciones fallidas",
		"slaReport.avgResponseTime": "Tiempo de respuesta medio",
		"slaReport.p95ResponseTime": "Tiempo de respuesta p95",
		"slaReport.incidents": "Incidencias",
		"slaReport.noIncidents": "Sin incidencias en este período",
		"slaReport.incidentCount": "Número de incidencias",
		"slaReport.totalDowntime": "Tiempo de inactividad total",
		"slaReport.longestIncident": "Incidencia más larga",
		"slaReport.dailyUptime": "Disponibilidad diaria",
		"slaReport.noData": "Sin datos para este período",
		"slaReport.generatedAt": "Generado el",
		"slaReport.emailSubject": "Informe SLA de {{monitor}} — {{period}}",
		"slaReport.emailIntro": "Aquí tienes tu informe SLA de {{monitor}} ({{period}}).",
		"slaReport.downloadPdf": "Descargar PDF completo",
		"slaReport.footer": "Enviado por Pulsy",
	},
};

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function isSupported(value: string): value is SupportedLanguage {
	return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Parse the most-preferred supported language from an Accept-Language header.
 */
export function parseAcceptLanguage(
	acceptLanguage: string | undefined | null,
): SupportedLanguage | undefined {
	if (!acceptLanguage) return undefined;

	const parts = acceptLanguage
		.split(",")
		.map((part) => {
			const [tag, qPart] = part.trim().split(";");
			const q = qPart?.startsWith("q=")
				? Number.parseFloat(qPart.slice(2))
				: 1;
			/* v8 ignore next -- defensive: String.split always yields ≥1 element, so the (tag ?? "") fallback is unreachable */
			return { tag: (tag ?? "").trim().toLowerCase(), q: Number.isNaN(q) ? 0 : q };
		})
		.filter((p) => p.tag.length > 0)
		.sort((a, b) => b.q - a.q);

	for (const { tag } of parts) {
		/* v8 ignore next -- defensive: String.split always yields ≥1 element, so the [0] ?? "" fallback is unreachable */
		const base = tag.split("-")[0] ?? "";
		if (isSupported(base)) return base;
	}

	return undefined;
}

/**
 * Resolve the effective language: explicit user preference wins, then the
 * Accept-Language header, then the default.
 */
export function getEffectiveLanguage(opts: {
	userPreference?: string | null;
	acceptLanguage?: string | null;
}): SupportedLanguage {
	if (opts.userPreference && isSupported(opts.userPreference)) {
		return opts.userPreference;
	}
	return parseAcceptLanguage(opts.acceptLanguage) ?? DEFAULT_LANGUAGE;
}

// ---------------------------------------------------------------------------
// Translator
// ---------------------------------------------------------------------------

function interpolate(
	template: string,
	vars?: Record<string, string | number>,
): string {
	if (!vars) return template;
	return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
		const value = vars[name];
		return value === undefined ? `{{${name}}}` : String(value);
	});
}

export function getTranslator(lang: SupportedLanguage): Translator {
	const dict = DICTIONARIES[lang] ?? DICTIONARIES[DEFAULT_LANGUAGE];
	const fallback = DICTIONARIES[DEFAULT_LANGUAGE];

	return (key, vars) => {
		const template = dict[key] ?? fallback[key] ?? key;
		return interpolate(template, vars);
	};
}
