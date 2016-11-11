/* This file is part of Indico.
 * Copyright (C) 2002 - 2016 European Organization for Nuclear Research (CERN).
 *
 * Indico is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 3 of the
 * License, or (at your option) any later version.
 *
 * Indico is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Indico; if not, see <http://www.gnu.org/licenses/>.
 */

/* global showFormErrors:false, initForms:false, confirmPrompt:false */

(function(global) {
    'use strict';

    var DROPZONE_FILE_KEYS = [
        'upload', 'status', 'previewElement', 'previewTemplate', '_removeLink',
        'accepted', 'width', 'height', 'processing', 'xhr'
    ];

    // TODO: maybe move those into a util module, they are also used in declarative
    function updateHtml(target, html, replace, highlight) {
        target = $(target);
        // TODO: preserve form data in updated elements
        if (replace) {
            var $html = $($.parseHTML(html));
            target.replaceWith($html);
            target = $html;
        } else {
            target.html(html);
        }
        target.trigger('indico:htmlUpdated');
        if (highlight) {
            target.effect('highlight', {color: '#5D95EA'});
        }
    }

    function handleHtmlUpdate(target, data, replace, highlight) {
        if ($.isPlainObject(target)) {
            for (var key in target) {
                if (!(key in data)) {
                    console.error('Invalid key: ' + key);  // eslint-disable-line no-console
                } else {
                    updateHtml(target[key], data[key], replace, highlight);
                }
            }
        } else {
            updateHtml(target, data.html, replace, highlight);
        }
    }

    global.inlineAjaxForm = function inlineAjaxForm(options) {
        options = $.extend(true, {
            // the element used to trigger events etc. may also be a selector.
            // when using it, the element should not be inside any element
            // that will be updated by this function as events would
            // not bubble up properly.  in many cases using the button that
            // triggers the loading of the form may be the most suitable
            // element unless it is being replaced with the form, in which case
            // its parent element may be a good candidate.
            context: null,
            // an element that triggers loading the form when clicked. if not set,
            // the form will be loaded immediately.
            trigger: null,
            // settings related to loading the form
            load: {
                url: null,
                method: 'GET',
                data: {}
            },
            // the element whose contents will be replaced with the form after
            // loading it.  may also be a selector.
            formContainer: null,
            // selector to match elements in the form which will act as a cancel
            // button reverting the form container to its previous state
            closeSelector: '[data-button-back]',
            // ask the user to confirm closing the form (or navigating away)
            // when there are unsaved changes
            confirmCloseUnsaved: false,
            // settings on what should be updated on successful submission
            update: {
                // the element to update with html received after successfully
                // submitting the form.  may also be a selector.
                element: null,
                // whether to replace the element itself instead of its contents
                replace: false,
                // whether to highlight the updated element for a short moment
                highlight: false
            }
        }, options);

        var formUrl = options.load.url;
        var formContainer = $(options.formContainer);
        var formVisible = false;
        var oldContent = null;
        var savedFiles = {};

        function triggerEvent(name) {
            if (!options.context) {
                return false;
            }
            var evt = $.Event(name);
            options.context.trigger(evt, [].slice.call(arguments, 1));
            return evt.isDefaultPrevented();
        }

        function updateFormUrl(xhr) {
            var loadedUrl = xhr.getResponseHeader('X-Indico-URL');
            if (loadedUrl) {
                // in case of a redirect we need to update the url used to submit
                // the ajaxified form.  otherwise url normalization might fail during
                // the POST requests.  we also remove the _=\d+ cache buster since
                // it's only relevant for the GET request and added there automatically
                formUrl = loadedUrl.replace(/&_=\d+/, '').replace(/\?_=\d+$/, '').replace(/\?_=\d+&/, '?');
            }
        }

        function loadForm() {
            $.ajax({
                url: options.load.url,
                method: options.load.method,
                data: options.load.data,
                cache: false,
                dataType: 'json',
                complete: IndicoUI.Dialogs.Util.progress(),
                error: function(xhr) {
                    if (!triggerEvent('ajaxForm:loadError', xhr)) {
                        handleAjaxError(xhr);
                    }
                },
                success: function(data, _, xhr) {
                    updateFormUrl(xhr);
                    showForm(data);
                }
            });
        }

        function showForm(data) {
            var triggerShow = false;
            if (!formVisible) {
                oldContent = formContainer.contents().detach();
                formVisible = true;
                triggerShow = true;
                if (options.confirmCloseUnsaved) {
                    $(window).on('beforeunload', onBeforeUnload);
                }
            }
            formContainer.html(data.html);
            formContainer.find(options.closeSelector).on('click', function(evt) {
                evt.preventDefault();
                var msg;
                if (options.confirmCloseUnsaved && (msg = onBeforeUnload()) !== undefined) {
                    confirmPrompt(msg, $T.gettext('Unsaved changes')).then(hideForm);
                } else {
                    hideForm();
                }
            });
            ajaxifyForms();
            if (data.js) {
                $('body').append(data.js);
            }
            if (triggerShow) {
                triggerEvent('ajaxForm:show');
            }
        }

        function hideForm() {
            if (!formVisible) {
                return;
            }
            formVisible = false;
            formContainer.html(oldContent);
            oldContent = null;
            if (options.confirmCloseUnsaved) {
                $(window).off('beforeunload', onBeforeUnload);
            }
            triggerEvent('ajaxForm:hide');
        }

        function ajaxifyForms() {
            var killProgress;
            var forms = formContainer.find('form');
            showFormErrors(formContainer);
            initForms(forms);
            forms.each(function() {
                var $this = $(this);
                $this.on('ajaxDialog:beforeSubmit', function() {
                    killProgress = IndicoUI.Dialogs.Util.progress();
                    // save files from dropzone fields so we can re-populate in case of failure
                    var dropzoneField = $this.data('dropzoneField');
                    if (dropzoneField) {
                        savedFiles[dropzoneField.id] = $this[0].dropzone.getUploadingFiles();
                    }
                }).on('ajaxDialog:error', function(evt, xhr) {
                    if (killProgress) {
                        killProgress();
                    }
                    evt.preventDefault();
                    handleAjaxError(xhr);
                }).on('ajaxDialog:success', function(evt, data) {
                    if (killProgress) {
                        killProgress();
                    }

                    if (data.success) {
                        savedFiles = {};
                        hideForm();
                        var updateOpts = options.update;
                        handleHtmlUpdate(updateOpts.element, data, updateOpts.replace, updateOpts.highlight);
                        if (data.redirect) {
                            IndicoUI.Dialogs.Util.progress();
                            location.href = data.redirect;
                        }
                    } else if (data.html) {
                        showForm(data);
                        // restore files in dropzone fields
                        $.each(savedFiles, function(id, files) {
                            var dropzone = $('#' + id).closest('form')[0].dropzone;
                            _.defer(function() {
                                files.forEach(function(file) {
                                    DROPZONE_FILE_KEYS.forEach(function(key) {
                                        delete file[key];
                                    });
                                    dropzone.addFile(file);
                                });
                            });
                        });
                        savedFiles = {};
                    }
                });
                $this.ajaxForm({
                    url: $this.attr('action') || formUrl,
                    dataType: 'json',
                    beforeSubmit: function() {
                        var evt = $.Event('ajaxDialog:validateBeforeSubmit');
                        $this.trigger(evt);
                        if (evt.isDefaultPrevented()) {
                            return false;
                        }
                        $this.trigger('ajaxDialog:beforeSubmit');
                    },
                    error: function(xhr) {
                        $this.trigger('ajaxDialog:error', [xhr]);
                    },
                    success: function(data) {
                        $this.trigger('ajaxDialog:success', [data]);
                    }
                });
            });
        }

        function hasChangedFields() {
            var forms = formContainer.find('form');
            return !!forms.length && !!forms.filter(function() {
                return $(this).data('fieldsChanged');
            }).length;
        }

        function onBeforeUnload() {
            if (hasChangedFields()) {
                return $T.gettext('You have unsaved changes that will be lost.');
            }
        }

        if (options.trigger) {
            options.trigger.on('click', function(evt) {
                evt.preventDefault();
                loadForm();
            });
        } else {
            loadForm();
        }
    };
})(window);