/*
Copyright 2012 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

//#REQUIRE "fields.js"

/**
 * This is needed due to what seems like a bug in Chrome where using drawImage
 * with any SVG, regardless of origin (even if it was loaded from a data URI),
 * marks the canvas's origin dirty flag, precluding us from accessing its pixel
 * data.
 */
var USE_CANVG = window.canvg && true;

/**
 * Represents a form field for image values.
 */
studio.forms.ImageField = studio.forms.Field.extend({
  constructor: function(id, params) {
    this.valueType_ = null;
    this.textParams_ = {};
    this.imageParams_ = {};
    this.spaceFormValues_ = {}; // cache
    this.base(id, params);
  },

  createUI: function(container) {
    var fieldUI = this.base(container);
    var fieldContainer = $('.form-field-container', fieldUI);

    var me = this;

    // Set up drag+drop on the entire field container
    fieldUI.addClass('form-field-drop-target');
    fieldUI.get(0).ondragenter = studio.forms.ImageField.makeDragenterHandler_(
      fieldUI);
    fieldUI.get(0).ondragleave = studio.forms.ImageField.makeDragleaveHandler_(
      fieldUI);
    fieldUI.get(0).ondragover = studio.forms.ImageField.makeDragoverHandler_(
      fieldUI);
    fieldUI.get(0).ondrop = studio.forms.ImageField.makeDropHandler_(fieldUI,
      function(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        studio.forms.ImageField.loadImageFromFileList(evt.dataTransfer.files, function(ret) {
          if (!ret)
            return;

          me.setValueType_('image');
          me.imageParams_ = ret;
          me.valueFilename_ = ret.name;
          me.renderValueAndNotifyChanged_();
        });
      });

    // Create radio buttons
    this.el_ = $('<div>')
      .attr('id', this.getHtmlId())
      .addClass('form-field-buttonset')
      .appendTo(fieldContainer);

    var types;
    if (this.params_.imageOnly) {
      types = [
        'image', 'Select Image'
      ];
    } else {
      types = [
        'image', 'Image',
        'clipart', 'Clipart',
        'text', 'Text'
      ];
    }

    var typeEls = {};

    for (var i = 0; i < types.length / 2; i++) {
      $('<input>')
        .attr({
          type: 'radio',
          name: this.getHtmlId(),
          id: this.getHtmlId() + '-' + types[i * 2],
          value: types[i * 2]
        })
        .appendTo(this.el_);
      typeEls[types[i * 2]] = $('<label>')
        .attr('for', this.getHtmlId() + '-' + types[i * 2])
        .text(types[i * 2 + 1])
        .appendTo(this.el_);
    }

    // Prepare UI for the 'image' type
    this.fileEl_ = $('<input>')
      .addClass('form-image-hidden-file-field')
      .attr({
        id: this.getHtmlId(),
        type: 'file',
        accept: 'image/*'
      })
      .change(function() {
        studio.forms.ImageField.loadImageFromFileList(me.fileEl_.get(0).files, function(ret) {
          if (!ret)
            return;

          me.setValueType_('image');
          me.imageParams_ = ret;
          me.valueFilename_ = ret.name;
          me.renderValueAndNotifyChanged_();
        });
      })
      .appendTo(this.el_);

    typeEls.image.click(function(evt) {
      me.fileEl_.trigger('click');
      me.setValueType_(null);
      me.renderValueAndNotifyChanged_();
      evt.preventDefault();
      return false;
    });

    // Prepare UI for the 'clipart' type
    if (!this.params_.imageOnly) {
      var clipartParamsEl = $('<div>')
        .addClass('form-image-type-params form-image-type-params-clipart')
        .hide()
        .appendTo(fieldContainer);

      var clipartListEl;

      var clipartFilterEl = $('<input>')
        .addClass('form-image-clipart-filter')
        .attr('placeholder', 'Find clipart')
        .keydown(function() {
          var $this = $(this);
          setTimeout(function() {
            var val = $this.val().toLowerCase().replace(/[^\w]+/g, '');
            if (!val) {
              clipartListEl.find('img').show();
            } else {
              clipartListEl.find('img').each(function() {
                var $this = $(this);
                $this.toggle($this.attr('title').indexOf(val) >= 0);
              });
            }
          }, 0);
        })
        .appendTo(clipartParamsEl);

      clipartListEl = $('<div>')
        .addClass('form-image-clipart-list')
        .addClass('cancel-parent-scroll')
        .appendTo(clipartParamsEl);

      for (var i = 0; i < studio.forms.ImageField.clipartList_.length; i++) {
        var clipartSrc = 'res/clipart/' + studio.forms.ImageField.clipartList_[i];
        $('<img>')
          .addClass('form-image-clipart-item')
          .attr('src', clipartSrc)
          .attr('title', studio.forms.ImageField.clipartList_[i])
          .click(function(clipartSrc) {
            return function() {
              me.loadClipart_(clipartSrc);
            };
          }(clipartSrc))
          .appendTo(clipartListEl);
      }

      var clipartAttributionEl = $('<div>')
        .addClass('form-image-clipart-attribution')
        .html([
            'Icons are by Google as a part of the new',
            '<a href="http://www.google.com/design">',
                'Material Design',
            '</a>'
          ].join(''))
        .appendTo(clipartParamsEl);

      typeEls.clipart.click(function(evt) {
        me.setValueType_('clipart');
        if (studio.AUTO_TRIM) {
          me.spaceFormTrimField_.setValue(false);
        }
        me.renderValueAndNotifyChanged_();
      });

      // Prepare UI for the 'text' type
      var textParamsEl = $('<div>')
        .addClass(
          'form-subform ' +
          'form-image-type-params ' +
          'form-image-type-params-text')
        .hide()
        .appendTo(fieldContainer);

      this.textForm_ = new studio.forms.Form(
        this.form_.id_ + '-' + this.id_ + '-textform', {
          onChange: function() {
            var values = me.textForm_.getValues();
            me.textParams_.text = values['text'];
            me.textParams_.fontStack = values['font']
                ? values['font'] : 'Roboto, sans-serif';
            me.valueFilename_ = values['text'];
            me.tryLoadWebFont_();
            me.renderValueAndNotifyChanged_();
          },
          fields: [
            new studio.forms.TextField('text', {
              title: 'Text',
            }),
            new studio.forms.AutocompleteTextField('font', {
              title: 'Font',
              items: studio.forms.ImageField.fontList_
            })
          ]
        });
      this.textForm_.createUI(textParamsEl);

      typeEls.text.click(function(evt) {
        me.setValueType_('text');
        if (studio.AUTO_TRIM) {
          me.spaceFormTrimField_.setValue(true);
        }
        me.renderValueAndNotifyChanged_();
      });
    }

    // Create spacing subform
    if (!this.params_.noTrimForm) {
      this.spaceFormValues_ = {};
      this.spaceForm_ = new studio.forms.Form(
        this.form_.id_ + '-' + this.id_ + '-spaceform', {
          onChange: function() {
            me.spaceFormValues_ = me.spaceForm_.getValues();
            me.renderValueAndNotifyChanged_();
          },
          fields: [
            (this.spaceFormTrimField_ = new studio.forms.BooleanField('trim', {
              title: 'Trim',
              defaultValue: this.params_.defaultValueTrim || false,
              offText: 'Don\'t Trim',
              onText: 'Trim'
            })),
            new studio.forms.RangeField('pad', {
              title: 'Padding',
              defaultValue: 0,
              min: -0.1,
              max: 0.5, // 1/2 of min(width, height)
              step: 0.05,
              textFn: function(v) {
                return (v * 100).toFixed(0) + '%';
              }
            }),
          ]
        });
      this.spaceForm_.createUI($('<div>')
        .addClass('form-subform')
        .appendTo(fieldContainer));
      this.spaceFormValues_ = this.spaceForm_.getValues();
    } else {
      this.spaceFormValues_ = {};
    }

    // Create image preview element
    if (!this.params_.noPreview) {
      this.imagePreview_ = $('<canvas>')
        .addClass('form-image-preview')
        .hide()
        .appendTo(fieldContainer.parent());
    }
  },

  tryLoadWebFont_: function(force) {
    var desiredFont = this.textForm_.getValues()['font'];
    if (this.loadedWebFont_ == desiredFont || !desiredFont) {
      return;
    }

    var me = this;
    if (!force) {
      if (this.tryLoadWebFont_.timeout_) {
        clearTimeout(this.tryLoadWebFont_.timeout_);
      }
      this.tryLoadWebFont_.timeout_ = setTimeout(function() {
        me.tryLoadWebFont_(true);
      }, 500);
      return;
    }

    this.loadedWebFont_ = desiredFont;
    var webFontNodeId = this.form_.id_ + '-' + this.id_ + '-__webfont-stylesheet__';
    $('#' + webFontNodeId).remove();
    $('<link>')
        .attr('id', webFontNodeId)
        .attr('rel', 'stylesheet')
        .attr('href', 'http://fonts.googleapis.com/css?family='
            + encodeURIComponent(desiredFont))
        .bind('load', function() {
          me.renderValueAndNotifyChanged_();
          window.setTimeout(function() {
            me.renderValueAndNotifyChanged_();
          }, 500);
        })
        .appendTo('head');
  },

  setValueType_: function(type) {
    this.valueType_ = type;
    $('input', this.el_).removeAttr('checked');
    $('.form-image-type-params', this.el_.parent()).hide();
    if (type) {
      $('#' + this.getHtmlId() + '-' + type).attr('checked', true);
      $('.form-image-type-params-' + type, this.el_.parent()).show();
    }
  },

  loadClipart_: function(clipartSrc) {
    var useCanvg = USE_CANVG && clipartSrc.match(/\.svg$/);

    $('img.form-image-clipart-item', this.el_.parent()).removeClass('selected');
    $('img[src="' + clipartSrc + '"]').addClass('selected');
    
    this.imageParams_ = {
      canvgSvgUri: useCanvg ? clipartSrc : null,
      uri: useCanvg ? null : clipartSrc
    };
    this.clipartSrc_ = clipartSrc;
    this.valueFilename_ = clipartSrc.match(/[^/]+$/)[0];
    this.renderValueAndNotifyChanged_();
  },

  clearValue: function() {
    this.valueType_ = null;
    this.valueFilename_ = null;
    this.valueCtx_ = null;
    this.fileEl_.val('');
    if (this.imagePreview_) {
      this.imagePreview_.hide();
    }
  },

  getValue: function() {
    return {
      ctx: this.valueCtx_,
      type: this.valueType_,
      name: this.valueFilename_
    };
  },

  // this function is asynchronous
  renderValueAndNotifyChanged_: function() {
    if (!this.valueType_) {
      this.valueCtx_ = null;
    }

    var me = this;

    // Render the base image (text, clipart, or image)
    switch (this.valueType_) {
      case 'image':
      case 'clipart':
        if (this.imageParams_.canvgSvgText || this.imageParams_.canvgSvgUri) {
          var canvas = document.createElement('canvas');
          var size = { w: 800, h: 800 };
          canvas.className = 'offscreen';
          canvas.width = size.w;
          canvas.height = size.h;
          document.body.appendChild(canvas);

          canvg(
            canvas,
            this.imageParams_.canvgSvgText ||
              this.imageParams_.canvgSvgUri,
            {
              scaleWidth: size.w,
              scaleHeight: size.h,
              ignoreMouse: true,
              ignoreAnimation: true,
              ignoreDimensions: true,
              ignoreClear: true
            }
          );
          continue_(canvas.getContext('2d'), size);

          document.body.removeChild(canvas);
        } else if (this.imageParams_.uri) {
          imagelib.loadFromUri(this.imageParams_.uri, function(img) {
            var size = {
              w: img.naturalWidth,
              h: img.naturalHeight
            };
            var ctx = imagelib.drawing.context(size);
            imagelib.drawing.copy(ctx, img, size);
            continue_(ctx, size);
          });
        }
        break;

      case 'text':
        var size = { w: 4800, h: 1600 };
        var textHeight = size.h * 0.75;
        var ctx = imagelib.drawing.context(size);
        var text = this.textParams_.text || '';
        text = ' ' + text + ' ';

        ctx.fillStyle = '#000';
        ctx.font = 'bold ' + textHeight + 'px/' + size.h + 'px ' + this.textParams_.fontStack;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, 0, textHeight);
        size.w = Math.ceil(Math.min(ctx.measureText(text).width, size.w) || size.w);

        continue_(ctx, size);
        break;

      default:
        me.form_.notifyChanged_(me);
    }

    function continue_(srcCtx, srcSize) {
      // Apply trimming
      if (me.spaceFormValues_['trim']) {
        if (me.trimWorker_) {
          me.trimWorker_.terminate();
        }
        me.trimWorker_ = imagelib.drawing.getTrimRect(srcCtx, srcSize, 1,
            function(trimRect) {
              continue2_(srcCtx, srcSize, trimRect);
            });
      } else {
        continue2_(srcCtx, srcSize,
            /*trimRect*/{ x: 0, y: 0, w: srcSize.w, h: srcSize.h });
      }
    }

    function continue2_(srcCtx, srcSize, trimRect) {
      // If trimming, add a tiny bit of padding to fix artifacts around the
      // edges.
      var extraPadding = me.spaceFormValues_['trim'] ? 0.001 : 0;
      if (trimRect.x == 0 && trimRect.y == 0 &&
          trimRect.w == srcSize.w && trimRect.h == srcSize.h) {
        extraPadding = 0;
      }

      var padPx = Math.round(((me.spaceFormValues_['pad'] || 0) + extraPadding) *
                  Math.min(trimRect.w, trimRect.h));
      var targetRect = { x: padPx, y: padPx, w: trimRect.w, h: trimRect.h };

      var outCtx = imagelib.drawing.context({
        w: trimRect.w + padPx * 2,
        h: trimRect.h + padPx * 2
      });

      // TODO: replace with a simple draw() as the centering is useless
      imagelib.drawing.drawCenterInside(outCtx, srcCtx, targetRect, trimRect);

      // Set the final URI value and show a preview
      me.valueCtx_ = outCtx;

      if (me.imagePreview_) {
        me.imagePreview_.attr('width', outCtx.canvas.width);
        me.imagePreview_.attr('height', outCtx.canvas.height);

        var previewCtx = me.imagePreview_.get(0).getContext('2d');
        previewCtx.drawImage(outCtx.canvas, 0, 0);

        me.imagePreview_.show();
      }

      me.form_.notifyChanged_(me);
    }
  },

  serializeValue: function() {
    return {
      type: this.valueType_,
      space: this.spaceForm_.getValuesSerialized(),
      clipart: (this.valueType_ == 'clipart') ? this.clipartSrc_ : null,
      text: (this.valueType_ == 'text') ? this.textForm_.getValuesSerialized()
                                        : null
    };
  },

  deserializeValue: function(o) {
    if (o.type) {
      this.setValueType_(o.type);
    }
    if (o.space) {
      this.spaceForm_.setValuesSerialized(o.space);
      this.spaceFormValues_ = this.spaceForm_.getValues();
    }
    if (o.clipart && this.valueType_ == 'clipart') {
      this.loadClipart_(o.clipart);
    }
    if (o.text && this.valueType_ == 'text') {
      this.textForm_.setValuesSerialized(o.text);
      this.tryLoadWebFont_();
    }
  }
});

studio.forms.ImageField.clipartList_ = [
'icons/access-alarms.svg',
'icons/access-time.svg',
'icons/accessibility.svg',
'icons/account-box.svg',
'icons/account-circle.svg',
'icons/adb.svg',
'icons/add-alarm.svg',
'icons/add-box.svg',
'icons/add-circle-outline.svg',
'icons/add-circle.svg',
'icons/add.svg',
'icons/airplane-mode-off.svg',
'icons/airplane-mode-on.svg',
'icons/android.svg',
'icons/apps.svg',
'icons/archive.svg',
'icons/arrow-back.svg',
'icons/arrow-drop-down-circle.svg',
'icons/arrow-drop-down.svg',
'icons/arrow-drop-up.svg',
'icons/arrow-forward.svg',
'icons/attachment.svg',
'icons/auto-fix.svg',
'icons/backspace.svg',
'icons/backup.svg',
'icons/beenhere.svg',
'icons/block.svg',
'icons/bluetooth-audio.svg',
'icons/bluetooth-connected.svg',
'icons/bluetooth-disabled.svg',
'icons/bluetooth-searching.svg',
'icons/bluetooth.svg',
'icons/bold.svg',
'icons/book.svg',
'icons/bookmark-outline.svg',
'icons/bookmark.svg',
'icons/brightness-auto.svg',
'icons/brightness-high.svg',
'icons/brightness-low.svg',
'icons/brightness-medium.svg',
'icons/bug-report.svg',
'icons/cake.svg',
'icons/call-end.svg',
'icons/call-made.svg',
'icons/call-merge.svg',
'icons/call-missed.svg',
'icons/call-received.svg',
'icons/call-split.svg',
'icons/call.svg',
'icons/camera-alt.svg',
'icons/camera-roll.svg',
'icons/camera.svg',
'icons/cancel.svg',
'icons/cast-connected.svg',
'icons/cast.svg',
'icons/chat.svg',
'icons/check-box-blank.svg',
'icons/check-box-outline-blank.svg',
'icons/check-box-outline.svg',
'icons/check-box.svg',
'icons/check-circle-blank.svg',
'icons/check-circle-outline-blank.svg',
'icons/check-circle-outline.svg',
'icons/check-circle.svg',
'icons/check.svg',
'icons/chevron-left.svg',
'icons/chevron-right.svg',
'icons/chromecast.svg',
'icons/circles-add.svg',
'icons/circles-extended.svg',
'icons/circles.svg',
'icons/clear.svg',
'icons/close-caption.svg',
'icons/close.svg',
'icons/cloud-circle.svg',
'icons/cloud-done.svg',
'icons/cloud-download.svg',
'icons/cloud-off.svg',
'icons/cloud-queue.svg',
'icons/cloud-upload.svg',
'icons/cloud.svg',
'icons/comment.svg',
'icons/communities.svg',
'icons/content-copy.svg',
'icons/content-cut.svg',
'icons/content-paste.svg',
'icons/create.svg',
'icons/credit-card.svg',
'icons/crop-free.svg',
'icons/crop-landscape.svg',
'icons/crop-portrait.svg',
'icons/crop-square.svg',
'icons/crop.svg',
'icons/data-usage.svg',
'icons/delete.svg',
'icons/developer-mode.svg',
'icons/dialpad.svg',
'icons/directions-bike.svg',
'icons/directions-bus.svg',
'icons/directions-car.svg',
'icons/directions-subway.svg',
'icons/directions-train.svg',
'icons/directions-transit.svg',
'icons/directions.svg',
'icons/directionswalk.svg',
'icons/disc-full.svg',
'icons/do-not-disturb.svg',
'icons/dock.svg',
'icons/domain.svg',
'icons/done-all.svg',
'icons/done.svg',
'icons/drafts.svg',
'icons/drive-apk.svg',
'icons/drive-audio.svg',
'icons/drive-code.svg',
'icons/drive-document.svg',
'icons/drive-drawing.svg',
'icons/drive-eta.svg',
'icons/drive-file.svg',
'icons/drive-font.svg',
'icons/drive-form.svg',
'icons/drive-fusiontable.svg',
'icons/drive-image.svg',
'icons/drive-ms-excel.svg',
'icons/drive-ms-powerpoint.svg',
'icons/drive-ms-word.svg',
'icons/drive-pdf.svg',
'icons/drive-presentation.svg',
'icons/drive-script.svg',
'icons/drive-site.svg',
'icons/drive-spreadsheet.svg',
'icons/drive-video.svg',
'icons/drive-zip.svg',
'icons/drive.svg',
'icons/earth.svg',
'icons/email.svg',
'icons/error.svg',
'icons/event.svg',
'icons/exit-to-app.svg',
'icons/expand-less.svg',
'icons/expand-more.svg',
'icons/explore.svg',
'icons/extension.svg',
'icons/fast-forward.svg',
'icons/fast-rewind.svg',
'icons/favorite-outline.svg',
'icons/favorite.svg',
'icons/file-download.svg',
'icons/file-upload.svg',
'icons/filter.svg',
'icons/flag.svg',
'icons/flash-auto.svg',
'icons/flash-off.svg',
'icons/flash-on.svg',
'icons/flights.svg',
'icons/flip-to-back.svg',
'icons/flip-to-front.svg',
'icons/folder-mydrive.svg',
'icons/folder-shared.svg',
'icons/folder.svg',
'icons/forum.svg',
'icons/forward.svg',
'icons/fullscreen-exit.svg',
'icons/fullscreen.svg',
'icons/gamepad.svg',
'icons/games.svg',
'icons/gesture.svg',
'icons/glass.svg',
'icons/gmail.svg',
'icons/google-plus.svg',
'icons/google.svg',
'icons/gps-fixed.svg',
'icons/gps-not-fixed.svg',
'icons/gps-off.svg',
'icons/group-add.svg',
'icons/group.svg',
'icons/hangout-video-off.svg',
'icons/hangout-video.svg',
'icons/hangout.svg',
'icons/headset-mic.svg',
'icons/headset.svg',
'icons/help.svg',
'icons/high-quality.svg',
'icons/history.svg',
'icons/home.svg',
'icons/hotel.svg',
'icons/https.svg',
'icons/image.svg',
'icons/import-export.svg',
'icons/inbox.svg',
'icons/info-outline.svg',
'icons/info.svg',
'icons/invert-colors.svg',
'icons/italics.svg',
'icons/keep.svg',
'icons/keyboard-alt.svg',
'icons/keyboard-arrow-down.svg',
'icons/keyboard-arrow-left.svg',
'icons/keyboard-arrow-right.svg',
'icons/keyboard-arrow-up.svg',
'icons/keyboard-backspace.svg',
'icons/keyboard-capslock.svg',
'icons/keyboard-control.svg',
'icons/keyboard-hide.svg',
'icons/keyboard-return.svg',
'icons/keyboard-tab.svg',
'icons/keyboard-voice.svg',
'icons/keyboard.svg',
'icons/label-outline.svg',
'icons/label.svg',
'icons/landscape.svg',
'icons/language.svg',
'icons/laptop.svg',
'icons/launch.svg',
'icons/link.svg',
'icons/list.svg',
'icons/live-help.svg',
'icons/location-city.svg',
'icons/location-disabled.svg',
'icons/location-searching.svg',
'icons/location.svg',
'icons/lock-open.svg',
'icons/lock-outline.svg',
'icons/lock.svg',
'icons/loop.svg',
'icons/mail.svg',
'icons/map.svg',
'icons/mark-unread.svg',
'icons/memory.svg',
'icons/menu.svg',
'icons/message.svg',
'icons/messenger.svg',
'icons/mic-none.svg',
'icons/mic-off.svg',
'icons/mic.svg',
'icons/mms.svg',
'icons/mood.svg',
'icons/more-horiz.svg',
'icons/more-vert.svg',
'icons/more.svg',
'icons/mouse.svg',
'icons/movie.svg',
'icons/nest-protect.svg',
'icons/nest-thermostat.svg',
'icons/network-cell.svg',
'icons/network-wifi.svg',
'icons/news.svg',
'icons/nfc.svg',
'icons/notifications-none.svg',
'icons/notifications-off.svg',
'icons/notifications-on.svg',
'icons/notifications-paused.svg',
'icons/notifications.svg',
'icons/pages.svg',
'icons/palette.svg',
'icons/panorama.svg',
'icons/party-mode.svg',
'icons/pause-circle-fill.svg',
'icons/pause-circle-outline.svg',
'icons/pause.svg',
'icons/people.svg',
'icons/person-add.svg',
'icons/person-location.svg',
'icons/person-outline.svg',
'icons/person.svg',
'icons/phone-bluetooth-speaker.svg',
'icons/phone-forwarded.svg',
'icons/phone-in-talk.svg',
'icons/phone-locked.svg',
'icons/phone-missed.svg',
'icons/phone-paused.svg',
'icons/phone.svg',
'icons/phone2.svg',
'icons/photo-album.svg',
'icons/photo-library.svg',
'icons/photo.svg',
'icons/place.svg',
'icons/play-arrow.svg',
'icons/play-circle-fill.svg',
'icons/play-circle-outline.svg',
'icons/play-download.svg',
'icons/play-install.svg',
'icons/plus-one.svg',
'icons/poll.svg',
'icons/polymer.svg',
'icons/portrait.svg',
'icons/post-blogger.svg',
'icons/post-facebook.svg',
'icons/post-gplus.svg',
'icons/post-instagram.svg',
'icons/post-linkedin.svg',
'icons/post-pinterest.svg',
'icons/post-tumblr.svg',
'icons/post-twitter.svg',
'icons/print.svg',
'icons/public.svg',
'icons/queue.svg',
'icons/radio-button-off.svg',
'icons/radio-button-on.svg',
'icons/receipt.svg',
'icons/refresh.svg',
'icons/reminder.svg',
'icons/remove-circle-outline.svg',
'icons/remove-circle.svg',
'icons/remove.svg',
'icons/replay.svg',
'icons/reply-all.svg',
'icons/reply.svg',
'icons/report.svg',
'icons/ring-volume.svg',
'icons/rotate-left.svg',
'icons/rotate-right.svg',
'icons/satellite.svg',
'icons/save.svg',
'icons/schedule.svg',
'icons/school.svg',
'icons/screen-lock-landscape.svg',
'icons/screen-lock-portrait.svg',
'icons/screen-lock-rotation.svg',
'icons/screen-rotation.svg',
'icons/sd-card.svg',
'icons/sd-storage.svg',
'icons/search.svg',
'icons/select-all.svg',
'icons/send.svg',
'icons/settings-application.svg',
'icons/settings-bluetooth.svg',
'icons/settings-cell.svg',
'icons/settings-phone.svg',
'icons/settings-power.svg',
'icons/settings-voice.svg',
'icons/settings.svg',
'icons/share-alt.svg',
'icons/share.svg',
'icons/shopping-basket.svg',
'icons/shopping-cart.svg',
'icons/shuffle.svg',
'icons/signal-cellular-1-bar.svg',
'icons/signal-cellular-2-bar.svg',
'icons/signal-cellular-3-bar.svg',
'icons/signal-cellular-4-bar.svg',
'icons/signal-wifi-1-bar.svg',
'icons/signal-wifi-2-bar.svg',
'icons/signal-wifi-3-bar.svg',
'icons/signal-wifi-4-bar.svg',
'icons/sim-card-alert.svg',
'icons/skip-next.svg',
'icons/skip-previous.svg',
'icons/slideshow.svg',
'icons/sms-failed.svg',
'icons/sms.svg',
'icons/sort.svg',
'icons/speaker.svg',
'icons/star-half.svg',
'icons/star-outline.svg',
'icons/star-rate.svg',
'icons/star.svg',
'icons/stop.svg',
'icons/storage.svg',
'icons/store.svg',
'icons/swap-driving-apps.svg',
'icons/swap-horiz.svg',
'icons/swap-vert-circle.svg',
'icons/swap-vert.svg',
'icons/switch-camera.svg',
'icons/switch-video.svg',
'icons/sync-disabled.svg',
'icons/sync-green.svg',
'icons/sync-problem-red.svg',
'icons/sync-problem.svg',
'icons/sync.svg',
'icons/system-update.svg',
'icons/tab-unselected.svg',
'icons/tab.svg',
'icons/tablet.svg',
'icons/tag-faces.svg',
'icons/tap-and-play.svg',
'icons/terrain.svg',
'icons/text-format.svg',
'icons/text-sms.svg',
'icons/theaters.svg',
'icons/thumbs-down.svg',
'icons/thumbs-up.svg',
'icons/time-to-leave.svg',
'icons/timelapse.svg',
'icons/timer.svg',
'icons/today.svg',
'icons/traffic.svg',
'icons/translate.svg',
'icons/tv.svg',
'icons/underline.svg',
'icons/undo.svg',
'icons/unfold-less.svg',
'icons/unfold-more.svg',
'icons/unknown-1.svg',
'icons/unknown-3.svg',
'icons/unknown-4.svg',
'icons/unknown-5.svg',
'icons/unknown-6.svg',
'icons/unknown-7.svg',
'icons/unkown-2.svg',
'icons/usb.svg',
'icons/vibration.svg',
'icons/video-youtube.svg',
'icons/videocam-off.svg',
'icons/videocam.svg',
'icons/view-array.svg',
'icons/view-column.svg',
'icons/view-headline.svg',
'icons/view-list.svg',
'icons/view-module.svg',
'icons/view-quilt.svg',
'icons/view-stream.svg',
'icons/visibility-off.svg',
'icons/visibility.svg',
'icons/voice.svg',
'icons/voicemail.svg',
'icons/volume-down.svg',
'icons/volume-mute.svg',
'icons/volume-off.svg',
'icons/volume-up.svg',
'icons/vpn.svg',
'icons/warning.svg',
'icons/watch.svg',
'icons/wb-auto.svg',
'icons/wb-cloudy.svg',
'icons/wb-incandescent.svg',
'icons/wb-irradescent.svg',
'icons/wb-sunny.svg',
'icons/web.svg',
'icons/whatshot.svg',
'icons/wifi-tethering.svg',
'icons/work.svg'
];

studio.forms.ImageField.fontList_ = [
  'Roboto',
  'Helvetica',
  'Arial',
  'Georgia',
  'Book Antiqua',
  'Palatino',
  'Courier',
  'Courier New',
  'Webdings',
  'Wingdings'
];

/**
 * Loads the first valid image from a FileList (e.g. drag + drop source), as a data URI. This method
 * will throw an alert() in case of errors and call back with null.
 * @param {FileList} fileList The FileList to load.
 * @param {Function} callback The callback to fire once image loading is done (or fails).
 * @return Returns an object containing 'uri' or 'canvgSvgText' fields representing
 *      the loaded image. There will also be a 'name' field indicating the file name, if one
 *      is available.
 */
studio.forms.ImageField.loadImageFromFileList = function(fileList, callback) {
  fileList = fileList || [];

  var file = null;
  for (var i = 0; i < fileList.length; i++) {
    if (studio.forms.ImageField.isValidFile_(fileList[i])) {
      file = fileList[i];
      break;
    }
  }

  if (!file) {
    alert('Please choose a valid image file (PNG, JPG, GIF, SVG, etc.)');
    callback(null);
    return;
  }

  var useCanvg = USE_CANVG && file.type == 'image/svg+xml';

  var fileReader = new FileReader();

  // Closure to capture the file information.
  fileReader.onload = function(e) {
    callback({
      uri: useCanvg ? null : e.target.result,
      canvgSvgText: useCanvg ? e.target.result : null,
      name: file.name
    });
  };
  fileReader.onerror = function(e) {
    switch(e.target.error.code) {
      case e.target.error.NOT_FOUND_ERR:
        alert('File not found!');
        break;
      case e.target.error.NOT_READABLE_ERR:
        alert('File is not readable');
        break;
      case e.target.error.ABORT_ERR:
        break; // noop
      default:
        alert('An error occurred reading this file.');
    }
    callback(null);
  };
  /*fileReader.onprogress = function(e) {
    $('#read-progress').css('visibility', 'visible');
    // evt is an ProgressEvent.
    if (e.lengthComputable) {
      $('#read-progress').val(Math.round((e.loaded / e.total) * 100));
    } else {
      $('#read-progress').removeAttr('value');
    }
  };*/
  fileReader.onabort = function(e) {
    alert('File read cancelled');
    callback(null);
  };
  /*fileReader.onloadstart = function(e) {
    $('#read-progress').css('visibility', 'visible');
  };*/
  if (useCanvg)
    fileReader.readAsText(file);
  else
    fileReader.readAsDataURL(file);
};

/**
 * Determines whether or not the given File is a valid value for the image.
 * 'File' here is a File using the W3C File API.
 * @private
 * @param {File} file Describe this parameter
 */
studio.forms.ImageField.isValidFile_ = function(file) {
  return !!file.type.toLowerCase().match(/^image\//);
};
/*studio.forms.ImageField.isValidFile_.allowedTypes = {
  'image/png': true,
  'image/jpeg': true,
  'image/svg+xml': true,
  'image/gif': true,
  'image/vnd.adobe.photoshop': true
};*/

studio.forms.ImageField.makeDropHandler_ = function(el, handler) {
  return function(evt) {
    $(el).removeClass('drag-hover');
    handler(evt);
  };
};

studio.forms.ImageField.makeDragoverHandler_ = function(el) {
  return function(evt) {
    el = $(el).get(0);
    if (el._studio_frm_dragtimeout_) {
      window.clearTimeout(el._studio_frm_dragtimeout_);
      el._studio_frm_dragtimeout_ = null;
    }
    evt.dataTransfer.dropEffect = 'link';
    evt.preventDefault();
  };
};

studio.forms.ImageField.makeDragenterHandler_ = function(el) {
  return function(evt) {
    el = $(el).get(0);
    if (el._studio_frm_dragtimeout_) {
      window.clearTimeout(el._studio_frm_dragtimeout_);
      el._studio_frm_dragtimeout_ = null;
    }
    $(el).addClass('drag-hover');
    evt.preventDefault();
  };
};

studio.forms.ImageField.makeDragleaveHandler_ = function(el) {
  return function(evt) {
    el = $(el).get(0);
    if (el._studio_frm_dragtimeout_)
      window.clearTimeout(el._studio_frm_dragtimeout_);
    el._studio_frm_dragtimeout_ = window.setTimeout(function() {
      $(el).removeClass('drag-hover');
    }, 100);
  };
};

// Prevent scrolling for clipart per http://stackoverflow.com/questions/7600454
$(document).ready(function() {
  $('.cancel-parent-scroll').on('mousewheel DOMMouseScroll',
    function(e) {
      var delta = e.originalEvent.wheelDelta || -e.originalEvent.detail;
      this.scrollTop -= delta;
      e.preventDefault();
    });
});
