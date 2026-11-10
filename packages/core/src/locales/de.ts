import { defineLocale } from "../i18n/bundle";

export const de = defineLocale({
  locale: "de",
  dir: "ltr",
  widget: {
    "common.withShortcut": "{label} ({shortcut})",

    "launcher.label": "Feedback",
    "launcher.labelWithPending": {
      one: "{label}, # nicht gesendeter Bericht",
      other: "{label}, # nicht gesendete Berichte",
    },
    "launcher.capturing": "Aufnahme…",

    "captureError.title": "Screenshot fehlgeschlagen",
    "captureError.failed": "Die Seite konnte nicht aufgenommen werden.",
    "captureError.unsupported": "Screenshots werden in diesem Browser nicht unterstützt.",
    "captureError.tryScreenCapture": "Bildschirmaufnahme versuchen",
    "captureError.continueWithout": "Ohne Screenshot fortfahren",
    "captureError.cancel": "Abbrechen",

    "dialog.title": "Feedback senden",
    "dialog.close": "Feedback-Dialog schließen",
    "dialog.closeShort": "Schließen",
    "dialog.screenshotRegion": "Screenshot",
    "dialog.detailsRegion": "Details",

    "warnings.title": "Teile der Seite konnten nicht exakt aufgenommen werden:",
    "warnings.useScreenCapture": "Stattdessen Bildschirmaufnahme verwenden",
    "warnings.dismiss": "Aufnahmehinweis ausblenden",

    "noScreenshot.title": "Kein Screenshot angehängt",
    "noScreenshot.description": "Das Feedback wird nur mit den Seitendetails gesendet.",
    "noScreenshot.capture": "Screenshot aufnehmen",
    "noScreenshot.screenCapture": "Bildschirmaufnahme verwenden",

    "toolbar.label": "Markierungswerkzeuge",
    "toolbar.tools": "Werkzeuge",
    "toolbar.color": "Farbe",
    "toolbar.colorOption": "Farbe {color}",
    "toolbar.strokeWidth": "Strichstärke",
    "toolbar.undo": "Rückgängig",
    "toolbar.redo": "Wiederholen",
    "toolbar.clear": "Markierungen löschen",
    "toolbar.zoom": "Zoom",
    "toolbar.zoomOut": "Verkleinern",
    "toolbar.zoomIn": "Vergrößern",
    "toolbar.zoomReset": "Zoom auf {percent} zurücksetzen",
    "toolbar.fit": "An Ansicht anpassen",
    "toolbar.resetScreenshot": "Screenshot zurücksetzen",
    "toolbar.retake": "Neu",
    "toolbar.retakeTooltip": "Screenshot neu aufnehmen",

    "tool.select": "Auswählen",
    "tool.pin": "Pin",
    "tool.arrow": "Pfeil",
    "tool.rectangle": "Rechteck",
    "tool.freehand": "Zeichnen",
    "tool.text": "Text",

    "stroke.thin": "Dünner Strich",
    "stroke.medium": "Mittlerer Strich",
    "stroke.thick": "Dicker Strich",
    "stroke.thinShort": "S",
    "stroke.mediumShort": "M",
    "stroke.thickShort": "L",

    "color.red": "Rot",
    "color.orange": "Orange",
    "color.amber": "Bernstein",
    "color.yellow": "Gelb",
    "color.green": "Grün",
    "color.emerald": "Smaragd",
    "color.cyan": "Cyan",
    "color.blue": "Blau",
    "color.indigo": "Indigo",
    "color.violet": "Violett",
    "color.purple": "Lila",
    "color.pink": "Pink",
    "color.black": "Schwarz",
    "color.white": "Weiß",

    "field.title": "Titel",
    "field.titlePlaceholder": "Was ist falsch oder was könnte besser sein?",
    "field.description": "Beschreibung",
    "field.descriptionPlaceholder": "Schritte zum Reproduzieren, erwartetes und tatsächliches Verhalten…",
    "field.optional": "Optional",
    "field.category": "Kategorie",
    "field.priority": "Priorität",
    "field.name": "Name",
    "field.email": "E-Mail",
    "field.pageUrl": "Seiten-URL:",

    "category.bug": "Fehler",
    "category.design": "Design",
    "category.content": "Inhalt",
    "category.feature": "Funktionswunsch",
    "category.other": "Sonstiges",

    "priority.low": "Niedrig",
    "priority.medium": "Mittel",
    "priority.high": "Hoch",
    "priority.critical": "Kritisch",

    "validation.titleRequired": "Kurzen Titel eingeben",
    "validation.titleTooLong": "Titel darf höchstens {max} Zeichen lang sein",
    "validation.titleInvalid": "Titel überprüfen",
    "validation.descriptionTooLong": "Beschreibung darf höchstens {max} Zeichen lang sein",
    "validation.descriptionInvalid": "Beschreibung überprüfen",
    "validation.nameTooLong": "Name darf höchstens {max} Zeichen lang sein",
    "validation.nameInvalid": "Name überprüfen",
    "validation.emailTooLong": "E-Mail-Adresse darf höchstens {max} Zeichen lang sein",
    "validation.emailInvalid": "Gültige E-Mail-Adresse eingeben",

    "submit.send": "Feedback senden",
    "submit.sending": "Wird gesendet…",
    "submit.retry": "Erneut versuchen",
    "submit.savedForRetry":
      "Der Bericht ist auf diesem Gerät gespeichert und wird automatisch erneut gesendet.",

    "progress.preparing": "Wird vorbereitet…",
    "progress.queued": "Wird lokal gespeichert…",
    "progress.sending": "Wird gesendet…",
    "progress.uploading": "Screenshots werden hochgeladen…",
    "progress.attempt": "Wird gesendet (Versuch {attempt} von {maxAttempts})…",
    "progress.retrying": "Neuer Versuch…",
    "progress.retryingIn": {
      one: "Neuer Versuch in # Sekunde…",
      other: "Neuer Versuch in # Sekunden…",
    },
    "progress.done": "Gesendet",
    "progress.failed": "Senden fehlgeschlagen",

    "error.network": "Server nicht erreichbar. Bitte Internetverbindung prüfen.",
    "error.timeout": "Der Server hat zu lange nicht geantwortet.",
    "error.validation": "Einige Felder sind ungültig.",
    "error.rateLimited": "Zu viele Berichte in kurzer Zeit. Bitte einen Moment warten.",
    "error.payloadTooLarge": "Der Bericht ist zu groß zum Senden.",
    "error.unsupportedMediaType": "Das Screenshot-Format wird vom Server nicht unterstützt.",
    "error.spam": "Dieser Bericht wurde als automatisiert abgelehnt.",
    "error.notionUnauthorized":
      "Der Feedback-Eingang ist nicht richtig verbunden. Bitte den Betreiber der Website informieren.",
    "error.notionNotFound":
      "Der Feedback-Eingang wurde nicht gefunden. Bitte den Betreiber der Website informieren.",
    "error.notionError": "Notion kann den Bericht gerade nicht speichern.",
    "error.serverError": "Auf dem Server ist ein Fehler aufgetreten.",
    "error.misconfigured":
      "Feedback ist auf dieser Website nicht richtig eingerichtet. Bitte den Betreiber der Website informieren.",
    "error.unknown": "Beim Senden ist ein Fehler aufgetreten.",

    "success.title": "An Notion gesendet",
    "success.thanks": "Danke für das Feedback!",
    "success.duplicate": "Dieser Bericht ist bereits eingegangen. Danke!",
    "success.openInNotion": "In Notion öffnen",
    "success.done": "Fertig",
    "success.announcement": "Feedback an Notion gesendet.",

    "confirm.title": "Feedback verwerfen?",
    "confirm.description": "Notizen und Markierungen gehen verloren.",
    "confirm.keep": "Weiter bearbeiten",
    "confirm.discard": "Verwerfen",
  },
  editor: {
    "editor.label":
      "Editor für Screenshot-Markierungen. Werkzeug in der Werkzeugleiste wählen, dann auf den Screenshot klicken oder ziehen.",
    "textInput.label":
      "Markierungstext. Eingabe zum Speichern, Umschalt+Eingabe für eine neue Zeile, Escape zum Abbrechen.",

    "pin.added": "Pin {number} hinzugefügt",
    "pin.moved": "Pin {number} verschoben",
    "pin.deleted": "Pin {number} gelöscht",
    "drawing.added": "Zeichnung hinzugefügt",
    "drawing.moved": "Zeichnung verschoben",
    "drawing.deleted": "Zeichnung gelöscht",
    "arrow.added": "Pfeil hinzugefügt",
    "arrow.moved": "Pfeil verschoben",
    "arrow.deleted": "Pfeil gelöscht",
    "rectangle.added": "Rechteck hinzugefügt",
    "rectangle.moved": "Rechteck verschoben",
    "rectangle.deleted": "Rechteck gelöscht",
    "text.added": "Text hinzugefügt",
    "text.updated": "Text aktualisiert",
    "text.moved": "Text verschoben",
    "text.deleted": "Text gelöscht",

    "history.undone": "Rückgängig gemacht",
    "history.redone": "Wiederholt",
    "annotations.cleared": "Alle Markierungen gelöscht",
    "annotations.reset": "Markierungen zurückgesetzt",
    "zoom.changed": "Zoom {percent}",
    "zoom.fit": "An Ansicht angepasst",
  },
  capture: {
    "placeholder.iframe": "Cross-Origin-iframe – Inhalt nicht erfasst",
    "placeholder.object": "Eingebettetes Objekt – Inhalt nicht erfasst",
    "placeholder.canvas": "Geschütztes Canvas – Inhalt nicht erfasst",
    "placeholder.video": "Video – Frame nicht erfasst",

    "warning.crossOriginIframe": {
      one: "# Cross-Origin-iframe konnte nicht erfasst werden, da der Browser das Auslesen seines Inhalts nicht erlaubt.",
      other:
        "# Cross-Origin-iframes konnten nicht erfasst werden, da der Browser das Auslesen ihres Inhalts nicht erlaubt.",
    },
    "warning.crossOriginImage": {
      one: "# Cross-Origin-Bild konnte nicht für den Screenshot geladen werden (durch CORS blockiert oder nicht erreichbar).",
      other:
        "# Cross-Origin-Bilder konnten nicht für den Screenshot geladen werden (durch CORS blockiert oder nicht erreichbar).",
    },
    "warning.taintedCanvas": {
      one: "# Canvas konnte nicht erfasst werden, da es Cross-Origin-Daten enthält.",
      other: "# Canvas-Elemente konnten nicht erfasst werden, da sie Cross-Origin-Daten enthalten.",
    },
    "warning.video": {
      one: "# Video entspricht möglicherweise nicht dem, was gerade abgespielt wurde.",
      other: "# Videos entsprechen möglicherweise nicht dem, was gerade abgespielt wurde.",
    },
    "warning.videoNotCaptured": {
      one: "# Video konnte nicht erfasst werden.",
      other: "# Videos konnten nicht erfasst werden.",
    },
    "warning.videoStill": {
      one: "# Video wurde als Standbild erfasst (aktueller Frame oder Posterbild); es entspricht möglicherweise nicht dem, was gerade abgespielt wurde.",
      other:
        "# Videos wurden als Standbilder erfasst (aktueller Frame oder Posterbild); sie entsprechen möglicherweise nicht dem, was gerade abgespielt wurde.",
    },
    "warning.embeddedObject": {
      one: "# eingebettetes Objekt (<object>/<embed>) konnte nicht erfasst werden.",
      other: "# eingebettete Objekte (<object>/<embed>) konnten nicht erfasst werden.",
    },
    "warning.imageFailed": {
      one: "# Bild konnte nicht für den Screenshot geladen werden.",
      other: "# Bilder konnten nicht für den Screenshot geladen werden.",
    },
    "warning.unknown": {
      one: "# Element konnte nicht exakt erfasst werden.",
      other: "# Elemente konnten nicht exakt erfasst werden.",
    },
    "warning.unknownGeneric": "Einige Inhalte konnten nicht exakt erfasst werden.",
    "warning.font":
      "Webfonts konnten nicht eingebettet werden; Text im Screenshot wird eventuell in einer Ersatzschrift angezeigt.",
    "warning.downscaled": "Der Screenshot wurde verkleinert, um die maximale Bildgröße einzuhalten.",
    "warning.sharedScreen":
      "Statt dieses Tabs wurde ein ganzer Bildschirm geteilt; der Screenshot kann andere Inhalte zeigen und die Positionen der Markierungen passen nicht zur Seite.",
    "warning.sharedWindow":
      "Statt dieses Tabs wurde ein Fenster geteilt; der Screenshot kann andere Inhalte zeigen und die Positionen der Markierungen passen nicht zur Seite.",
    "warning.labelledPlaceholders": "Betroffene Bereiche werden als beschriftete Platzhalter dargestellt.",
    "warning.hatchedPlaceholders": "Betroffene Bereiche werden als schraffierte Platzhalter dargestellt.",
    "warning.leftBlank": "Betroffene Bereiche bleiben leer.",
  },
  report: {
    callout: "{category} · {priority}",
    calloutWithReporter: "{category} · {priority} · gemeldet von {reporter}",
    priorityLow: "Niedrige Priorität",
    priorityMedium: "Mittlere Priorität",
    priorityHigh: "Hohe Priorität",
    priorityCritical: "Kritische Priorität",

    headingDescription: "Beschreibung",
    headingAnnotatedScreenshot: "Screenshot mit Markierungen",
    headingOriginalScreenshot: "Original-Screenshot",
    headingAnnotations: "Markierungen",
    headingCaptureNotes: "Hinweise zur Aufnahme",
    headingEnvironment: "Umgebung",

    noDescription: "Keine Beschreibung angegeben.",
    captionAnnotatedScreenshot: "Screenshot mit Markierungen",
    captionOriginalScreenshot: "Originalaufnahme ohne Markierungen",

    fieldLabel: "{label}: ",
    pinNumber: "#{number}",
    pinNoNote: "(keine Notiz)",
    textAnnotationLabel: "Text",
    quotedText: "„{text}“",
    shapesLabel: "Formen",
    arrowCount: { one: "# Pfeil", other: "# Pfeile" },
    rectangleCount: { one: "# Rechteck", other: "# Rechtecke" },
    freehandCount: { one: "# Freihandzeichnung", other: "# Freihandzeichnungen" },

    warningCrossOriginIframe: {
      one: "Ein Cross-Origin-iframe konnte nicht erfasst werden.",
      other: "# Cross-Origin-iframes konnten nicht erfasst werden.",
    },
    warningCrossOriginImage: {
      one: "Ein Cross-Origin-Bild konnte nicht für den Screenshot geladen werden.",
      other: "# Cross-Origin-Bilder konnten nicht für den Screenshot geladen werden.",
    },
    warningTaintedCanvas: {
      one: "Ein Canvas mit Cross-Origin-Daten konnte nicht erfasst werden.",
      other: "# Canvas-Elemente mit Cross-Origin-Daten konnten nicht erfasst werden.",
    },
    warningVideo: {
      one: "Ein Video konnte nicht oder nur als Standbild erfasst werden.",
      other: "# Videos konnten nicht oder nur als Standbilder erfasst werden.",
    },
    warningFont: {
      one: "Webfonts konnten nicht eingebettet werden; Text wird eventuell in einer Ersatzschrift angezeigt.",
      other: "Webfonts konnten nicht eingebettet werden; Text wird eventuell in einer Ersatzschrift angezeigt.",
    },
    warningDownscaled: {
      one: "Der Screenshot wurde verkleinert, um die maximale Bildgröße einzuhalten.",
      other: "Der Screenshot wurde verkleinert, um die maximale Bildgröße einzuhalten.",
    },
    warningUnknown: {
      one: "Ein Element konnte nicht erfasst werden.",
      other: "# Elemente konnten nicht erfasst werden.",
    },

    envUrl: "URL",
    envPageTitle: "Seitentitel",
    envBrowser: "Browser",
    envOs: "Betriebssystem",
    envViewport: "Viewport",
    envScreen: "Bildschirm",
    envPixelRatio: "Gerätepixelverhältnis",
    envLanguage: "Sprache",
    envTimezone: "Zeitzone",
    envReferrer: "Referrer",
    envCaptureMethod: "Aufnahmemethode",
    envUserAgent: "User-Agent",
    envSubmittedAt: "Gesendet am",
    dimensions: "{width}×{height}",
    captureMethodDom: "DOM-Rendering",
    captureMethodDisplayMedia: "Bildschirmaufnahme",
    captureMethodWithSize: "{method} ({size})",
    dateTimeUtc: "{dateTime} UTC",
    submissionId: "Einreichungs-ID",
  },
});

export default de;
