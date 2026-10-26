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
		"checkErrors.dns_not_found": "DNS lookup failed — domain not found (NXDOMAIN)",
		"checkErrors.dns_temporary": "DNS lookup failed temporarily (resolver error)",
		"checkErrors.dns_no_records": "DNS lookup returned no records",
		"checkErrors.connection_refused": "Connection refused",
		"checkErrors.connection_reset": "Connection reset by the server",
		"checkErrors.connection_timeout": "Connection timed out",
		"checkErrors.response_timeout": "Timed out after {{seconds}} s",
		"checkErrors.response_timeout_unknown": "Timed out waiting for a response",
		"checkErrors.tls_expired": "TLS certificate has expired",
		"checkErrors.tls_untrusted": "TLS certificate is not trusted",
		"checkErrors.tls_hostname_mismatch": "TLS certificate does not match the hostname",
		"checkErrors.tls_error": "TLS handshake failed",
		"checkErrors.too_many_redirects": "Too many redirects (more than 5)",
		"checkErrors.redirect_rejected": "Redirect rejected by the request policy",
		"checkErrors.blocked_target": "Destination blocked by the network policy",
		"checkErrors.unexpected_status": "Unexpected HTTP status",
		"checkErrors.unexpected_status_code": "Unexpected HTTP status {{status}}",
		"checkErrors.assertion_failed": "Response did not match the configured checks",
		"checkErrors.invalid_configuration": "Monitor configuration is invalid",
		"checkErrors.heartbeat_late": "Expected heartbeat is late",
		"checkErrors.heartbeat_missed": "Expected heartbeat was missed",
		"checkErrors.heartbeat_failed": "Job explicitly reported failure",
		"checkErrors.heartbeat_unfinished": "Started job did not finish before its deadline",
		"checkErrors.unknown": "Check failed (unclassified network error)",
		"errors.apiKeyExpiry": "Choose an API key expiry date after today (UTC).",
		"validation.required": "This field is required.",
		"validation.email": "Enter a valid email address, for example alerts@example.com.",
		"errors.manifestJson": "Invalid JSON near line {{line}}, column {{column}}: {{reason}}",
		"errors.jsonReason.incomplete": "The input is incomplete. Close any open strings, arrays or objects.",
		"errors.jsonReason.property": "Object property names must use double quotes.",
		"errors.jsonReason.separator": "Check for a missing comma or colon.",
		"errors.jsonReason.syntax": "Check JSON syntax, quotes and values.",
		"validation.reviewFields": "Review the highlighted fields and try again.",
		"validation.telegramTarget": "Enter a Telegram bot token and chat ID as BOT_TOKEN:CHAT_ID; the chat ID must be numeric or @channel.",
		"validation.invalidField": "Enter a valid value.",
		"validation.statusPageSlug": "Use 1–63 Latin letters or numbers separated by single hyphens. Surrounding spaces are trimmed and letters are saved in lowercase.",
		"validation.timezone": "Enter a valid timezone, such as Europe/Berlin or UTC.",
		"errors.httpCredentialOrigin": "Saved request credentials cannot be sent to a different address. Re-enter the headers or authentication for the new URL.",
		"errors.manifestInvalid": "Review the configuration manifest and its rejected entries. Nothing was applied.",
		"errors.manifestInvalidLine": "The configuration file is not valid near line {{line}}. Nothing was applied. Fix that line and preview again.",
		"errors.manifestInvalidField": "The configuration file has a problem with “{{field}}”. Nothing was applied. Correct it and preview again.",
		"errors.networkBusy": "Check capacity is busy. Try again; no check result was recorded.",
		"errors.statusPageCommunicationInvalid": "Invalid status-page communication. Check components, publication and maintenance times.",
		"errors.httpBodyJSON": "The JSON request body is invalid or exceeds depth 16 or 10,000 nodes.",
		"errors.httpPostConfirm": "POST requests can have side effects. Confirm before testing.",
		"errors.httpTestBusy": "Another configuration test is running. Try again after it finishes.",
		"errors.httpAssertionPath": "JSON paths use $ followed by dotted keys or numeric array indexes.",
		"errors.httpAssertionValue": "This JSON comparison requires a value.",
		"errors.httpAssertionNumeric": "Numeric comparisons require a finite number.",
		"errors.httpHeaderName": "Header names must be unique and must not override transport headers.",
		"errors.httpHeaderValue": "Header values must not contain line breaks.",
		"errors.httpRequestLimit": "Request values exceed the permitted size.",
		"errors.httpDestination": "Use an HTTP or HTTPS URL without embedded credentials.",
		"errors.targetBlocked": "Blocked target: private, link-local, metadata, or otherwise unsafe destination.",
		"errors.httpBodyMethod": "A request body requires the POST method; clear it before changing method.",
		"errors.latencyRecoveryThreshold": "Recovery latency must be at or below the degradation threshold, or both limits must be disabled.",
		"errors.shareLinkLimit": "This account has reached the limit of {{max}} active share links. Revoke an unused link and retry.",
		"errors.channelLimit": "This account has reached the limit of {{max}} notification channels. Remove an unused channel and retry.",
		"errors.emailProviderLimit": "This account has reached the limit of {{max}} email providers. Remove an unused provider and retry.",
		"errors.slaSubscriptionLimit": "This account has reached the limit of {{max}} SLA report subscriptions. Remove an unused subscription and retry.",
		"errors.apiKeyLimit": "This account has reached the limit of {{max}} active API keys. Revoke an unused key and retry.",
		"errors.maintenanceTimezone": "Maintenance timezone must be an IANA timezone.",
		"errors.maintenanceDuration": "End must follow start; recurring windows last at most 24 hours and one-time windows 30 days.",
		"errors.requestFailed": "Pulsy could not process this request. Reference: {{requestId}}.",
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
		"checkErrors.dns_not_found": "فشل بحث DNS — النطاق غير موجود (NXDOMAIN)",
		"checkErrors.dns_temporary": "فشل بحث DNS مؤقتًا (خطأ في المحلّل)",
		"checkErrors.dns_no_records": "لم يُرجع بحث DNS أي سجلات",
		"checkErrors.connection_refused": "تم رفض الاتصال",
		"checkErrors.connection_reset": "أعاد الخادم تعيين الاتصال",
		"checkErrors.connection_timeout": "انتهت مهلة الاتصال",
		"checkErrors.response_timeout": "انتهت المهلة بعد {{seconds}} ث",
		"checkErrors.response_timeout_unknown": "انتهت مهلة انتظار الاستجابة",
		"checkErrors.tls_expired": "انتهت صلاحية شهادة TLS",
		"checkErrors.tls_untrusted": "شهادة TLS غير موثوقة",
		"checkErrors.tls_hostname_mismatch": "شهادة TLS لا تطابق اسم المضيف",
		"checkErrors.tls_error": "فشل مصافحة TLS",
		"checkErrors.too_many_redirects": "عدد مفرط من عمليات إعادة التوجيه (أكثر من 5)",
		"checkErrors.redirect_rejected": "رفضت سياسة الطلبات إعادة التوجيه",
		"checkErrors.blocked_target": "الوجهة محظورة بموجب سياسة الشبكة",
		"checkErrors.unexpected_status": "حالة HTTP غير متوقعة",
		"checkErrors.unexpected_status_code": "حالة HTTP غير متوقعة {{status}}",
		"checkErrors.assertion_failed": "لم تطابق الاستجابة الفحوصات المضبوطة",
		"checkErrors.invalid_configuration": "إعدادات المراقب غير صالحة",
		"checkErrors.heartbeat_late": "النبض المتوقع متأخر",
		"checkErrors.heartbeat_missed": "لم يصل النبض المتوقع",
		"checkErrors.heartbeat_failed": "أبلغت المهمة صراحة عن فشل",
		"checkErrors.heartbeat_unfinished": "لم ينته التشغيل الذي بدأ قبل موعده",
		"checkErrors.unknown": "فشل الفحص (خطأ شبكة غير مصنّف)",
		"errors.apiKeyExpiry": "اختر تاريخ انتهاء لمفتاح API بعد اليوم (UTC).",
		"validation.required": "هذا الحقل مطلوب.",
		"validation.email": "أدخل بريدًا إلكترونيًا صالحًا، مثل alerts@example.com.",
		"errors.manifestJson": "JSON غير صالح قرب السطر {{line}}، العمود {{column}}: {{reason}}",
		"errors.jsonReason.incomplete": "الإدخال غير مكتمل. أغلق النصوص أو المصفوفات أو الكائنات المفتوحة.",
		"errors.jsonReason.property": "يجب وضع أسماء الخصائص بين علامتي اقتباس مزدوجتين.",
		"errors.jsonReason.separator": "تحقق من وجود فاصلة أو نقطتين مفقودتين.",
		"errors.jsonReason.syntax": "تحقق من صيغة JSON وعلامات الاقتباس والقيم.",
		"validation.reviewFields": "راجع الحقول المحددة وحاول مرة أخرى.",
		"validation.telegramTarget": "أدخل رمز بوت Telegram ومعرّف الدردشة بصيغة BOT_TOKEN:CHAT_ID؛ ويجب أن يكون معرّف الدردشة رقميًا أو @channel.",
		"validation.invalidField": "أدخل قيمة صالحة.",
		"validation.statusPageSlug": "استخدم من 1 إلى 63 حرفًا لاتينيًا أو رقمًا، مع شرطة واحدة بين الأجزاء. تُحذف المسافات المحيطة وتُحفظ الأحرف بحروف صغيرة.",
		"validation.timezone": "أدخل منطقة زمنية صالحة، مثل Europe/Berlin أو UTC.",
		"errors.httpCredentialOrigin": "لا يمكن إرسال بيانات الطلب المحفوظة إلى عنوان مختلف. أعد إدخال الترويسات أو المصادقة للعنوان الجديد.",
		"errors.manifestInvalid": "راجع بيان الإعدادات والعناصر المرفوضة. لم يُطبّق شيء.",
		"errors.manifestInvalidLine": "ملف الإعدادات غير صالح قرب السطر {{line}}. لم يُطبّق شيء. أصلح هذا السطر وأعد المعاينة.",
		"errors.manifestInvalidField": "في ملف الإعدادات مشكلة في «{{field}}». لم يُطبّق شيء. صحّحها وأعد المعاينة.",
		"errors.networkBusy": "سعة الفحص مشغولة. حاول مجددًا؛ لم تُسجّل نتيجة فحص.",
		"errors.statusPageCommunicationInvalid": "بيانات التواصل في صفحة الحالة غير صالحة. تحقق من المكونات والنشر وأوقات الصيانة.",
		"errors.httpBodyJSON": "نص طلب JSON غير صالح أو يتجاوز عمق 16 أو 10000 عقدة.",
		"errors.httpPostConfirm": "قد تكون لطلبات POST آثار جانبية. أكد قبل الاختبار.",
		"errors.httpTestBusy": "اختبار إعداد آخر قيد التشغيل. حاول بعد انتهائه.",
		"errors.httpAssertionPath": "تستخدم مسارات JSON الرمز $ ثم مفاتيح منقوطة أو فهارس مصفوفات رقمية.",
		"errors.httpAssertionValue": "تتطلب مقارنة JSON هذه قيمة.",
		"errors.httpAssertionNumeric": "تتطلب المقارنات الرقمية رقمًا محدودًا.",
		"errors.httpHeaderName": "يجب أن تكون أسماء الترويسات فريدة وألا تتجاوز ترويسات النقل.",
		"errors.httpHeaderValue": "يجب ألا تحتوي قيم الترويسات على فواصل أسطر.",
		"errors.httpRequestLimit": "تتجاوز قيم الطلب الحجم المسموح.",
		"errors.httpDestination": "استخدم رابط HTTP أو HTTPS بدون بيانات اعتماد مضمنة.",
		"errors.targetBlocked": "الوجهة محظورة: عنوان خاص أو محلي أو بيانات وصفية أو وجهة غير آمنة.",
		"errors.httpBodyMethod": "يتطلب نص الطلب طريقة POST؛ امسحه قبل تغيير الطريقة.",
		"errors.latencyRecoveryThreshold": "يجب أن يكون حد زمن التعافي أقل من حد التدهور أو مساويًا له، أو يجب تعطيل الحدّين.",
		"errors.shareLinkLimit": "بلغ هذا الحساب الحد الأقصى وهو {{max}} رابط مشاركة نشط. ألغِ رابطًا غير مستخدم وحاول مجددًا.",
		"errors.channelLimit": "بلغ هذا الحساب الحد الأقصى وهو {{max}} قناة إشعار. احذف قناة غير مستخدمة وحاول مجددًا.",
		"errors.emailProviderLimit": "بلغ هذا الحساب الحد الأقصى وهو {{max}} مزوّد بريد. احذف مزوّدًا غير مستخدم وحاول مجددًا.",
		"errors.slaSubscriptionLimit": "بلغ هذا الحساب الحد الأقصى وهو {{max}} اشتراك في تقارير SLA. احذف اشتراكًا غير مستخدم وحاول مجددًا.",
		"errors.apiKeyLimit": "بلغ هذا الحساب الحد الأقصى وهو {{max}} مفتاح API نشط. ألغِ مفتاحًا غير مستخدم وحاول مجددًا.",
		"errors.maintenanceTimezone": "يجب اختيار منطقة زمنية وفق IANA للصيانة.",
		"errors.maintenanceDuration": "يجب أن تلي النهاية البداية؛ الحد الأقصى 24 ساعة للنوافذ المتكررة و30 يومًا للنافذة الواحدة.",
		"errors.requestFailed": "تعذّر على Pulsy معالجة هذا الطلب. المرجع: {{requestId}}.",
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
		"checkErrors.dns_not_found": "Échec de la résolution DNS : domaine introuvable (NXDOMAIN)",
		"checkErrors.dns_temporary": "Échec temporaire de la résolution DNS (erreur du résolveur)",
		"checkErrors.dns_no_records": "La résolution DNS n’a renvoyé aucun enregistrement",
		"checkErrors.connection_refused": "Connexion refusée",
		"checkErrors.connection_reset": "Connexion réinitialisée par le serveur",
		"checkErrors.connection_timeout": "Délai de connexion dépassé",
		"checkErrors.response_timeout": "Délai dépassé après {{seconds}} s",
		"checkErrors.response_timeout_unknown": "Délai dépassé en attendant une réponse",
		"checkErrors.tls_expired": "Le certificat TLS a expiré",
		"checkErrors.tls_untrusted": "Le certificat TLS n’est pas approuvé",
		"checkErrors.tls_hostname_mismatch": "Le certificat TLS ne correspond pas au nom d’hôte",
		"checkErrors.tls_error": "Échec de la négociation TLS",
		"checkErrors.too_many_redirects": "Trop de redirections (plus de 5)",
		"checkErrors.redirect_rejected": "Redirection refusée par la politique de requêtes",
		"checkErrors.blocked_target": "Destination bloquée par la politique réseau",
		"checkErrors.unexpected_status": "Statut HTTP inattendu",
		"checkErrors.unexpected_status_code": "Statut HTTP inattendu : {{status}}",
		"checkErrors.assertion_failed": "La réponse ne correspond pas aux vérifications configurées",
		"checkErrors.invalid_configuration": "La configuration du moniteur est invalide",
		"checkErrors.heartbeat_late": "Le signal de vie attendu est en retard",
		"checkErrors.heartbeat_missed": "Le signal de vie attendu n’a pas été reçu",
		"checkErrors.heartbeat_failed": "La tâche a explicitement signalé un échec",
		"checkErrors.heartbeat_unfinished": "La tâche démarrée n’a pas terminé avant son échéance",
		"checkErrors.unknown": "Échec du contrôle (erreur réseau non classée)",
		"errors.apiKeyExpiry": "Choisissez une date d’expiration de clé API après aujourd’hui (UTC).",
		"validation.required": "Ce champ est obligatoire.",
		"validation.email": "Saisissez une adresse e-mail valide, par exemple alerts@example.com.",
		"errors.manifestJson": "JSON invalide vers la ligne {{line}}, colonne {{column}} : {{reason}}",
		"errors.jsonReason.incomplete": "Le contenu est incomplet. Fermez les chaînes, tableaux ou objets ouverts.",
		"errors.jsonReason.property": "Les noms des propriétés doivent être entre guillemets doubles.",
		"errors.jsonReason.separator": "Vérifiez les virgules et les deux-points manquants.",
		"errors.jsonReason.syntax": "Vérifiez la syntaxe JSON, les guillemets et les valeurs.",
		"validation.reviewFields": "Vérifiez les champs signalés et réessayez.",
		"validation.telegramTarget": "Saisissez un jeton de bot Telegram et un ID de conversation au format BOT_TOKEN:CHAT_ID ; l’ID de conversation doit être numérique ou @channel.",
		"validation.invalidField": "Saisissez une valeur valide.",
		"validation.statusPageSlug": "Utilisez de 1 à 63 lettres latines ou chiffres, séparés par un seul tiret. Les espaces autour sont supprimés et les lettres sont enregistrées en minuscules.",
		"validation.timezone": "Saisissez un fuseau horaire valide, comme Europe/Berlin ou UTC.",
		"errors.httpCredentialOrigin": "Les identifiants de requête enregistrés ne peuvent pas être envoyés à une autre adresse. Saisissez à nouveau les en-têtes ou l’authentification pour la nouvelle URL.",
		"errors.manifestInvalid": "Vérifiez le manifeste et ses éléments refusés. Rien n’a été appliqué.",
		"errors.manifestInvalidLine": "Le fichier de configuration n’est pas valide près de la ligne {{line}}. Rien n’a été appliqué. Corrigez cette ligne et prévisualisez à nouveau.",
		"errors.manifestInvalidField": "Le fichier de configuration comporte un problème avec « {{field}} ». Rien n’a été appliqué. Corrigez-le et prévisualisez à nouveau.",
		"errors.networkBusy": "La capacité de contrôle est occupée. Réessayez ; aucun résultat n’a été enregistré.",
		"errors.statusPageCommunicationInvalid": "Communication de page de statut invalide. Vérifiez les composants, la publication et les horaires de maintenance.",
		"errors.httpBodyJSON": "Le corps JSON est invalide ou dépasse une profondeur de 16 ou 10 000 nœuds.",
		"errors.httpPostConfirm": "Les requêtes POST peuvent avoir des effets de bord. Confirmez avant le test.",
		"errors.httpTestBusy": "Un autre test de configuration est en cours. Réessayez après sa fin.",
		"errors.httpAssertionPath": "Les chemins JSON utilisent $ suivi de clés séparées par des points ou d’indices numériques.",
		"errors.httpAssertionValue": "Cette comparaison JSON nécessite une valeur.",
		"errors.httpAssertionNumeric": "Les comparaisons numériques nécessitent un nombre fini.",
		"errors.httpHeaderName": "Les noms d’en-tête doivent être uniques et ne pas remplacer les en-têtes de transport.",
		"errors.httpHeaderValue": "Les valeurs d’en-tête ne doivent pas contenir de sauts de ligne.",
		"errors.httpRequestLimit": "Les valeurs de la requête dépassent la taille autorisée.",
		"errors.httpDestination": "Utilisez une URL HTTP ou HTTPS sans identifiants intégrés.",
		"errors.targetBlocked": "Destination bloquée : adresse privée, lien local, métadonnées ou destination dangereuse.",
		"errors.httpBodyMethod": "Un corps de requête nécessite POST ; effacez-le avant de changer de méthode.",
		"errors.latencyRecoveryThreshold": "Le seuil de rétablissement doit être inférieur ou égal au seuil de dégradation, ou les deux doivent être désactivés.",
		"errors.shareLinkLimit": "Ce compte a atteint la limite de {{max}} liens de partage actifs. Révoquez un lien inutilisé et réessayez.",
		"errors.channelLimit": "Ce compte a atteint la limite de {{max}} canaux de notification. Supprimez un canal inutilisé et réessayez.",
		"errors.emailProviderLimit": "Ce compte a atteint la limite de {{max}} fournisseurs d’e-mail. Supprimez un fournisseur inutilisé et réessayez.",
		"errors.slaSubscriptionLimit": "Ce compte a atteint la limite de {{max}} abonnements aux rapports SLA. Supprimez un abonnement inutilisé et réessayez.",
		"errors.apiKeyLimit": "Ce compte a atteint la limite de {{max}} clés API actives. Révoquez une clé inutilisée et réessayez.",
		"errors.maintenanceTimezone": "Le fuseau de maintenance doit être un fuseau IANA.",
		"errors.maintenanceDuration": "La fin doit suivre le début ; maximum 24 heures pour les fenêtres récurrentes et 30 jours pour les fenêtres uniques.",
		"errors.requestFailed": "Pulsy n’a pas pu traiter cette requête. Référence : {{requestId}}.",
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
		"checkErrors.dns_not_found": "DNS-Abfrage fehlgeschlagen – Domain nicht gefunden (NXDOMAIN)",
		"checkErrors.dns_temporary": "DNS-Abfrage vorübergehend fehlgeschlagen (Resolver-Fehler)",
		"checkErrors.dns_no_records": "DNS-Abfrage lieferte keine Einträge",
		"checkErrors.connection_refused": "Verbindung abgelehnt",
		"checkErrors.connection_reset": "Verbindung vom Server zurückgesetzt",
		"checkErrors.connection_timeout": "Zeitüberschreitung beim Verbindungsaufbau",
		"checkErrors.response_timeout": "Zeitüberschreitung nach {{seconds}} s",
		"checkErrors.response_timeout_unknown": "Zeitüberschreitung beim Warten auf eine Antwort",
		"checkErrors.tls_expired": "TLS-Zertifikat ist abgelaufen",
		"checkErrors.tls_untrusted": "TLS-Zertifikat ist nicht vertrauenswürdig",
		"checkErrors.tls_hostname_mismatch": "TLS-Zertifikat passt nicht zum Hostnamen",
		"checkErrors.tls_error": "TLS-Handshake fehlgeschlagen",
		"checkErrors.too_many_redirects": "Zu viele Weiterleitungen (mehr als 5)",
		"checkErrors.redirect_rejected": "Weiterleitung von der Anfragerichtlinie abgelehnt",
		"checkErrors.blocked_target": "Ziel durch die Netzwerkrichtlinie blockiert",
		"checkErrors.unexpected_status": "Unerwarteter HTTP-Status",
		"checkErrors.unexpected_status_code": "Unerwarteter HTTP-Status {{status}}",
		"checkErrors.assertion_failed": "Antwort entspricht nicht den konfigurierten Prüfungen",
		"checkErrors.invalid_configuration": "Monitor-Konfiguration ist ungültig",
		"checkErrors.heartbeat_late": "Erwarteter Heartbeat ist verspätet",
		"checkErrors.heartbeat_missed": "Erwarteter Heartbeat ist ausgeblieben",
		"checkErrors.heartbeat_failed": "Aufgabe hat ausdrücklich einen Fehler gemeldet",
		"checkErrors.heartbeat_unfinished": "Gestartete Aufgabe wurde vor der Frist nicht beendet",
		"checkErrors.unknown": "Prüfung fehlgeschlagen (nicht klassifizierter Netzwerkfehler)",
		"errors.apiKeyExpiry": "Wählen Sie ein Ablaufdatum für den API-Schlüssel nach dem heutigen Tag (UTC).",
		"validation.required": "Dieses Feld ist erforderlich.",
		"validation.email": "Geben Sie eine gültige E-Mail-Adresse ein, zum Beispiel alerts@example.com.",
		"errors.manifestJson": "Ungültiges JSON bei Zeile {{line}}, Spalte {{column}}: {{reason}}",
		"errors.jsonReason.incomplete": "Die Eingabe ist unvollständig. Schließen Sie offene Zeichenfolgen, Arrays oder Objekte.",
		"errors.jsonReason.property": "Eigenschaftsnamen müssen in doppelten Anführungszeichen stehen.",
		"errors.jsonReason.separator": "Prüfen Sie auf fehlende Kommas oder Doppelpunkte.",
		"errors.jsonReason.syntax": "Prüfen Sie JSON-Syntax, Anführungszeichen und Werte.",
		"validation.reviewFields": "Prüfe die markierten Felder und versuche es erneut.",
		"validation.telegramTarget": "Geben Sie Telegram-Bot-Token und Chat-ID als BOT_TOKEN:CHAT_ID ein; die Chat-ID muss numerisch oder @channel sein.",
		"validation.invalidField": "Gib einen gültigen Wert ein.",
		"validation.statusPageSlug": "Verwende 1–63 lateinische Buchstaben oder Ziffern, getrennt durch einzelne Bindestriche. Äußere Leerzeichen werden entfernt und Buchstaben kleingeschrieben.",
		"validation.timezone": "Gib eine gültige Zeitzone ein, etwa Europe/Berlin oder UTC.",
		"errors.httpCredentialOrigin": "Gespeicherte Anfragedaten können nicht an eine andere Adresse gesendet werden. Geben Sie Header oder Authentifizierung für die neue URL erneut ein.",
		"errors.manifestInvalid": "Prüfen Sie das Konfigurationsmanifest und abgelehnte Einträge. Nichts wurde angewendet.",
		"errors.manifestInvalidLine": "Die Konfigurationsdatei ist nahe Zeile {{line}} ungültig. Nichts wurde angewendet. Korrigieren Sie diese Zeile und erstellen Sie die Vorschau erneut.",
		"errors.manifestInvalidField": "Die Konfigurationsdatei hat ein Problem bei „{{field}}“. Nichts wurde angewendet. Korrigieren Sie es und erstellen Sie die Vorschau erneut.",
		"errors.networkBusy": "Die Prüfkapazität ist belegt. Erneut versuchen; kein Prüfergebnis wurde gespeichert.",
		"errors.statusPageCommunicationInvalid": "Ungültige Angaben zur Statusseite. Prüfen Sie Komponenten, Veröffentlichung und Wartungszeiten.",
		"errors.httpBodyJSON": "Der JSON-Anfragekörper ist ungültig oder überschreitet Tiefe 16 oder 10.000 Knoten.",
		"errors.httpPostConfirm": "POST-Anfragen können Nebenwirkungen haben. Bestätigen Sie vor dem Test.",
		"errors.httpTestBusy": "Ein weiterer Konfigurationstest läuft. Versuchen Sie es nach dessen Abschluss erneut.",
		"errors.httpAssertionPath": "JSON-Pfade verwenden $ mit durch Punkte getrennten Schlüsseln oder numerischen Array-Indizes.",
		"errors.httpAssertionValue": "Dieser JSON-Vergleich erfordert einen Wert.",
		"errors.httpAssertionNumeric": "Numerische Vergleiche erfordern eine endliche Zahl.",
		"errors.httpHeaderName": "Header-Namen müssen eindeutig sein und dürfen Transport-Header nicht überschreiben.",
		"errors.httpHeaderValue": "Header-Werte dürfen keine Zeilenumbrüche enthalten.",
		"errors.httpRequestLimit": "Die Anfragewerte überschreiten die zulässige Größe.",
		"errors.httpDestination": "Verwenden Sie eine HTTP- oder HTTPS-URL ohne eingebettete Zugangsdaten.",
		"errors.targetBlocked": "Ziel blockiert: privates, lokales, Metadaten- oder anderweitig unsicheres Ziel.",
		"errors.httpBodyMethod": "Ein Anfragekörper erfordert POST; löschen Sie ihn vor dem Methodenwechsel.",
		"errors.latencyRecoveryThreshold": "Die Erholungsschwelle muss höchstens der Beeinträchtigungsschwelle entsprechen, oder beide Grenzen müssen deaktiviert sein.",
		"errors.shareLinkLimit": "Dieses Konto hat das Limit von {{max}} aktiven Freigabelinks erreicht. Widerrufen Sie einen ungenutzten Link und versuchen Sie es erneut.",
		"errors.channelLimit": "Dieses Konto hat das Limit von {{max}} Benachrichtigungskanälen erreicht. Entfernen Sie einen ungenutzten Kanal und versuchen Sie es erneut.",
		"errors.emailProviderLimit": "Dieses Konto hat das Limit von {{max}} E-Mail-Anbietern erreicht. Entfernen Sie einen ungenutzten Anbieter und versuchen Sie es erneut.",
		"errors.slaSubscriptionLimit": "Dieses Konto hat das Limit von {{max}} SLA-Bericht-Abonnements erreicht. Entfernen Sie ein ungenutztes Abonnement und versuchen Sie es erneut.",
		"errors.apiKeyLimit": "Dieses Konto hat das Limit von {{max}} aktiven API-Schlüsseln erreicht. Widerrufen Sie einen ungenutzten Schlüssel und versuchen Sie es erneut.",
		"errors.maintenanceTimezone": "Die Wartungszeitzone muss eine IANA-Zeitzone sein.",
		"errors.maintenanceDuration": "Das Ende muss nach dem Beginn liegen; maximal 24 Stunden für wiederkehrende und 30 Tage für einmalige Fenster.",
		"errors.requestFailed": "Pulsy konnte diese Anfrage nicht verarbeiten. Referenz: {{requestId}}.",
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
		"checkErrors.dns_not_found": "Falló la búsqueda DNS: dominio no encontrado (NXDOMAIN)",
		"checkErrors.dns_temporary": "Falló temporalmente la búsqueda DNS (error del resolvedor)",
		"checkErrors.dns_no_records": "La búsqueda DNS no devolvió registros",
		"checkErrors.connection_refused": "Conexión rechazada",
		"checkErrors.connection_reset": "El servidor restableció la conexión",
		"checkErrors.connection_timeout": "Se agotó el tiempo de la conexión",
		"checkErrors.response_timeout": "Tiempo agotado tras {{seconds}} s",
		"checkErrors.response_timeout_unknown": "Se agotó el tiempo de espera de la respuesta",
		"checkErrors.tls_expired": "El certificado TLS ha caducado",
		"checkErrors.tls_untrusted": "El certificado TLS no es de confianza",
		"checkErrors.tls_hostname_mismatch": "El certificado TLS no coincide con el nombre de host",
		"checkErrors.tls_error": "Falló el handshake TLS",
		"checkErrors.too_many_redirects": "Demasiadas redirecciones (más de 5)",
		"checkErrors.redirect_rejected": "Redirección rechazada por la política de solicitudes",
		"checkErrors.blocked_target": "Destino bloqueado por la política de red",
		"checkErrors.unexpected_status": "Estado HTTP inesperado",
		"checkErrors.unexpected_status_code": "Estado HTTP inesperado: {{status}}",
		"checkErrors.assertion_failed": "La respuesta no cumplió las comprobaciones configuradas",
		"checkErrors.invalid_configuration": "La configuración del monitor no es válida",
		"checkErrors.heartbeat_late": "El latido esperado llega tarde",
		"checkErrors.heartbeat_missed": "No llegó el latido esperado",
		"checkErrors.heartbeat_failed": "La tarea informó expresamente de un fallo",
		"checkErrors.heartbeat_unfinished": "La tarea iniciada no terminó antes del plazo",
		"checkErrors.unknown": "La comprobación falló (error de red sin clasificar)",
		"errors.apiKeyExpiry": "Elige una fecha de caducidad de la clave API posterior a hoy (UTC).",
		"validation.required": "Este campo es obligatorio.",
		"validation.email": "Introduce una dirección válida, por ejemplo alerts@example.com.",
		"errors.manifestJson": "JSON no válido cerca de la línea {{line}}, columna {{column}}: {{reason}}",
		"errors.jsonReason.incomplete": "El contenido está incompleto. Cierra las cadenas, matrices u objetos abiertos.",
		"errors.jsonReason.property": "Los nombres de las propiedades deben usar comillas dobles.",
		"errors.jsonReason.separator": "Comprueba si falta una coma o dos puntos.",
		"errors.jsonReason.syntax": "Comprueba la sintaxis JSON, las comillas y los valores.",
		"validation.reviewFields": "Revisa los campos señalados e inténtalo de nuevo.",
		"validation.telegramTarget": "Introduce un token de bot de Telegram y un ID de chat con el formato BOT_TOKEN:CHAT_ID; el ID de chat debe ser numérico o @canal.",
		"validation.invalidField": "Introduce un valor válido.",
		"validation.statusPageSlug": "Usa de 1 a 63 letras latinas o números separados por un solo guion. Se eliminan los espacios exteriores y las letras se guardan en minúsculas.",
		"validation.timezone": "Introduce una zona horaria válida, como Europe/Berlin o UTC.",
		"errors.httpCredentialOrigin": "Las credenciales de solicitud guardadas no pueden enviarse a otra dirección. Vuelva a introducir los encabezados o la autenticación para la nueva URL.",
		"errors.manifestInvalid": "Revise el manifiesto y los elementos rechazados. No se aplicó nada.",
		"errors.manifestInvalidLine": "El archivo de configuración no es válido cerca de la línea {{line}}. No se aplicó nada. Corrija esa línea y vuelva a previsualizar.",
		"errors.manifestInvalidField": "El archivo de configuración tiene un problema con «{{field}}». No se aplicó nada. Corríjalo y vuelva a previsualizar.",
		"errors.networkBusy": "La capacidad de comprobación está ocupada. Reinténtalo; no se registró ningún resultado.",
		"errors.statusPageCommunicationInvalid": "La comunicación de la página de estado no es válida. Revise los componentes, la publicación y los horarios de mantenimiento.",
		"errors.httpBodyJSON": "El cuerpo JSON no es válido o supera la profundidad 16 o 10 000 nodos.",
		"errors.httpPostConfirm": "Las solicitudes POST pueden tener efectos secundarios. Confirme antes de probar.",
		"errors.httpTestBusy": "Hay otra prueba de configuración en curso. Inténtelo cuando termine.",
		"errors.httpAssertionPath": "Las rutas JSON usan $ seguido de claves separadas por puntos o índices numéricos.",
		"errors.httpAssertionValue": "Esta comparación JSON requiere un valor.",
		"errors.httpAssertionNumeric": "Las comparaciones numéricas requieren un número finito.",
		"errors.httpHeaderName": "Los nombres de cabecera deben ser únicos y no reemplazar cabeceras de transporte.",
		"errors.httpHeaderValue": "Los valores de cabecera no deben contener saltos de línea.",
		"errors.httpRequestLimit": "Los valores de la solicitud superan el tamaño permitido.",
		"errors.httpDestination": "Use una URL HTTP o HTTPS sin credenciales integradas.",
		"errors.targetBlocked": "Destino bloqueado: dirección privada, local, de metadatos o destino no seguro.",
		"errors.httpBodyMethod": "El cuerpo requiere POST; bórrelo antes de cambiar el método.",
		"errors.latencyRecoveryThreshold": "El umbral de recuperación debe ser menor o igual al de degradación, o ambos deben estar desactivados.",
		"errors.shareLinkLimit": "Esta cuenta alcanzó el límite de {{max}} enlaces para compartir activos. Revoque un enlace sin usar e inténtelo de nuevo.",
		"errors.channelLimit": "Esta cuenta alcanzó el límite de {{max}} canales de notificación. Elimine un canal sin usar e inténtelo de nuevo.",
		"errors.emailProviderLimit": "Esta cuenta alcanzó el límite de {{max}} proveedores de correo. Elimine un proveedor sin usar e inténtelo de nuevo.",
		"errors.slaSubscriptionLimit": "Esta cuenta alcanzó el límite de {{max}} suscripciones a informes SLA. Elimine una suscripción sin usar e inténtelo de nuevo.",
		"errors.apiKeyLimit": "Esta cuenta alcanzó el límite de {{max}} claves API activas. Revoque una clave sin usar e inténtelo de nuevo.",
		"errors.maintenanceTimezone": "La zona horaria del mantenimiento debe ser una zona IANA.",
		"errors.maintenanceDuration": "El final debe ser posterior al inicio; máximo 24 horas para ventanas recurrentes y 30 días para ventanas únicas.",
		"errors.requestFailed": "Pulsy no pudo procesar esta solicitud. Referencia: {{requestId}}.",
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
