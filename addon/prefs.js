// Defaults must match src/modules/prefs.ts.
pref("__prefsPrefix__.tagPrefix", "grp");
pref("__prefsPrefix__.tagType", 1);
pref("__prefsPrefix__.navigateOnClick", true);
pref("__prefsPrefix__.arrowKeysScroll", false);
pref("__prefsPrefix__.persistStickyGroup", true);
pref("__prefsPrefix__.stickyGroupsByItem", "{}");
pref("__prefsPrefix__.libraryColorRules", "[]");
pref("__prefsPrefix__.itemColorRules", "{}");
pref("__prefsPrefix__.templateId", "markdown");
pref("__prefsPrefix__.includeSubfolders", true);
pref("__prefsPrefix__.includeUngrouped", true);
pref("__prefsPrefix__.warningAcknowledged", false);
pref("__prefsPrefix__.useCustomSelectionColor", false);
pref("__prefsPrefix__.selectionColor", "#2ea8e5");
pref("__prefsPrefix__.stickyOnCreate", false);
pref("__prefsPrefix__.syncSettings", true);
pref("__prefsPrefix__.pinGroupsPanel", true);
pref("__prefsPrefix__.entryFormat", "{text} ({label}[: {page}])");
pref("__prefsPrefix__.labelFilterMode", "off");
pref("__prefsPrefix__.labelFilter", "");
pref("__prefsPrefix__.texPageBreak", false);
// prettier-ignore
pref("__prefsPrefix__.texPreamble", "\\documentclass[12pt,letterpaper]{article}\n\\usepackage[top=.75in, bottom=.75in, left=.75in, right=.75in, includehead, includefoot, marginparwidth=.75in, marginparsep=.125in]{geometry}\n\\setlength{\\parskip}{.15in}\n\\usepackage{hyperref}\n\\usepackage{graphicx}\n\n\\RequirePackage{datetime}\n\\settimeformat{ampmtime}\n\\newdateformat{dashdate}{\\THEYEAR-\\twodigit{\\THEMONTH}-\\twodigit{\\THEDAY}}\n\\newtimeformat{dottime}{\\twodigit{\\THEHOUR}:\\twodigit{\\THEMINUTE}:\\twodigit{\\THESECOND}}\n\n\\RequirePackage{lastpage}    %% Required for pages of page number\n\\RequirePackage{fancyhdr}   %must come after geometry\n\\pagestyle{fancy}\n\\renewcommand{\\sectionmark}[1]{\\markright{Sec.\\thesection:\\ #1}{}}\n\\fancyhead{} % clear all header fields\n\\fancyhead[L]{\\small{\\textbf{$title$}}}\n\\fancyhead[R]{\\small{Joshua S. Glazer}}\n\\fancyfoot{}\n\\fancyfoot[L]{\\scriptsize{\\thepage\\ of \\pageref{LastPage}}}\n\\fancyfoot[R]{\\scriptsize{\\dashdate{\\today} at \\dottime}}\n\\renewcommand{\\headrulewidth}{0.4pt}\n\\renewcommand{\\footrulewidth}{0.4pt}");
